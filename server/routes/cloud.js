import express from 'express';
import fs from 'node:fs';
import YAML from 'yaml';
import { getCloudStatus, runCloudSyncNow, scheduleCloudSync, testCloudRemote } from '../cloud-sync.js';
import { listCloudLog } from '../db.js';
import {
  appendRcloneLog,
  authorizeGoogleDrive,
  checkRemoteExists,
  getRcloneLog,
  rcloneAboutJson,
  rcloneConfigDelete,
  rcloneConfigShow,
  rcloneVersion
} from '../rclone.js';
import { CONFIG_PATH, readConfig } from '../utils.js';

const router = express.Router();
const GOOGLE_DRIVE_REMOTE = 'savesync-gdrive';

/**
 * Tracks the in-flight OAuth authorization state.
 * status: 'idle' | 'pending' | 'success' | 'error'
 */
let googleDriveAuth = {
  status: 'idle',
  error: null,
  proc: null
};

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(config), 'utf8');
}

function normalizeRemotePath(input) {
  const value = String(input ?? '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (!value) throw new Error('Informe a pasta de destino no Google Drive.');
  if (/[\r\n]/.test(value)) throw new Error('A pasta de destino não pode conter quebras de linha.');
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeSyncInterval(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('O intervalo de sincronização precisa ser de pelo menos 1 minuto.');
  }
  return Math.floor(value);
}

function enableGoogleDriveConfig(overrides = {}) {
  const config = readConfig();
  config.cloud = {
    ...(config.cloud || {}),
    enabled: true,
    provider: 'google_drive',
    remote_name: GOOGLE_DRIVE_REMOTE,
    remote_path: overrides.remote_path || config.cloud?.remote_path || 'SaveSync/',
    sync_interval_minutes: overrides.sync_interval_minutes || config.cloud?.sync_interval_minutes || 5,
    bidirectional: config.cloud?.bidirectional ?? true,
    on_conflict: config.cloud?.on_conflict || 'keep_both'
  };
  writeConfig(config);
}

function disableGoogleDriveConfig() {
  const config = readConfig();
  config.cloud = {
    ...(config.cloud || {}),
    enabled: false,
    provider: 'google_drive',
    remote_name: GOOGLE_DRIVE_REMOTE
  };
  writeConfig(config);
}

function parseTokenFromConfigShow(output) {
  const tokenLine = output
    .split(/\r?\n/)
    .find(line => line.trim().startsWith('token = '));
  if (!tokenLine) return null;

  try {
    return JSON.parse(tokenLine.slice(tokenLine.indexOf('=') + 1).trim());
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function parseJson(input) {
  try {
    return JSON.parse(input || '{}');
  } catch {
    return null;
  }
}

async function getGoogleDriveProvider() {
  const config = readConfig();
  const dbStatus = await getCloudStatus();
  const remoteExists = await checkRemoteExists(GOOGLE_DRIVE_REMOTE);
  const configShow = remoteExists ? await rcloneConfigShow(GOOGLE_DRIVE_REMOTE) : { ok: false, stdout: '' };
  const token = configShow.ok ? parseTokenFromConfigShow(configShow.stdout) : null;

  // Storage info can fail (expired token, network) — don't let it break the provider response
  let storage = null;
  try {
    if (configShow.ok) {
      const about = await rcloneAboutJson(GOOGLE_DRIVE_REMOTE);
      if (about?.ok) storage = parseJson(about.stdout);
    }
  } catch (err) {
    console.warn('Failed to fetch Google Drive storage info:', err.message);
  }

  // Token exists in rclone config = connected
  const isConnected = Boolean(remoteExists && configShow.ok && token);

  return {
    id: 'google-drive',
    name: 'Google Drive',
    icon: 'google-drive',
    connected: isConnected,
    last_sync: dbStatus.last_sync,
    files_synced: dbStatus.files_synced,
    account_email: null,
    token_expiry: token?.expiry || null,
    remote_name: config.cloud?.remote_name || GOOGLE_DRIVE_REMOTE,
    remote_path: config.cloud?.remote_path || 'SaveSync/',
    sync_interval_minutes: config.cloud?.sync_interval_minutes || 5,
    storage_used: storage?.used ?? null,
    storage_used_label: formatBytes(storage?.used),
    storage_total: storage?.total ?? null,
    storage_total_label: formatBytes(storage?.total)
  };
}

async function hasGoogleDriveToken() {
  const remoteExists = await checkRemoteExists(GOOGLE_DRIVE_REMOTE);
  if (!remoteExists) return false;
  const configShow = await rcloneConfigShow(GOOGLE_DRIVE_REMOTE);
  if (!configShow.ok) return false;
  return Boolean(parseTokenFromConfigShow(configShow.stdout));
}

// ─── Routes ───────────────────────────────────────────────────

router.get('/status', async (_req, res) => {
  res.json(await getCloudStatus());
});

router.post('/sync-now', async (_req, res) => {
  const result = await runCloudSyncNow({ reason: 'api' });
  res.status(result.ok ? 200 : 409).json(result);
});

router.get('/log', (_req, res) => {
  res.json({ db: listCloudLog(100), live: getRcloneLog() });
});

router.post('/test', async (_req, res) => {
  const result = await testCloudRemote();
  res.status(result.ok ? 200 : 502).json(result);
});

router.get('/auth/providers', async (_req, res) => {
  try {
    res.json({ providers: [await getGoogleDriveProvider()] });
  } catch (error) {
    console.error('Error fetching providers:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/cloud/auth/google-drive/start
 * Starts the Rclone OAuth flow for Google Drive.
 * Rclone opens the user's browser to Google's consent screen
 * and spins up localhost:53682 to receive the callback.
 */
router.post('/auth/google-drive/start', async (_req, res) => {
  // If already pending, just report it
  if (googleDriveAuth.status === 'pending' && googleDriveAuth.proc) {
    return res.json({ status: 'browser_opened' });
  }

  // Check if rclone is available
  const version = await rcloneVersion();
  if (!version.ok) {
    googleDriveAuth = {
      status: 'error',
      error: 'Rclone não instalado ou não encontrado no PATH. Instale o Rclone para conectar ao Google Drive.',
      proc: null
    };
    return res.status(502).json({ status: 'error', error: googleDriveAuth.error });
  }

  // Check if already authorized
  if (await hasGoogleDriveToken()) {
    enableGoogleDriveConfig();
    scheduleCloudSync();
    googleDriveAuth = { status: 'success', error: null, proc: null };
    return res.json({ status: 'already_connected' });
  }

  // Kill any previous auth process
  if (googleDriveAuth.proc) {
    try { googleDriveAuth.proc.kill('SIGTERM'); } catch { /* ignore */ }
  }

  // Delete existing remote to start fresh
  await rcloneConfigDelete(GOOGLE_DRIVE_REMOTE).catch(() => null);

  // Start the OAuth flow
  const proc = authorizeGoogleDrive({ remoteName: GOOGLE_DRIVE_REMOTE });
  googleDriveAuth = { status: 'pending', error: null, proc };
  appendRcloneLog('Abrindo autorização OAuth do Google Drive no browser', 'info');

  let output = '';
  const collect = level => chunk => {
    const text = chunk.toString();
    output += text;
    text.split(/\r?\n/).filter(Boolean).forEach(line => appendRcloneLog(line, level));
  };

  proc.stdout.on('data', collect('info'));
  proc.stderr.on('data', collect('warn'));

  proc.on('error', error => {
    googleDriveAuth = { status: 'error', error: error.message, proc: null };
    appendRcloneLog(`Erro no processo rclone: ${error.message}`, 'error');
  });

  proc.on('close', async code => {
    appendRcloneLog(`rclone config create finalizado com código ${code}`, code === 0 ? 'info' : 'error');

    if (code === 0) {
      // Verify the token was actually saved
      const tokenOk = await hasGoogleDriveToken();
      if (tokenOk) {
        enableGoogleDriveConfig();
        scheduleCloudSync();
        googleDriveAuth = { status: 'success', error: null, proc: null };
        appendRcloneLog('✓ Google Drive conectado ao SaveSync', 'info');
      } else {
        // rclone exited 0 but no token found — user may have denied or something went wrong
        googleDriveAuth = {
          status: 'error',
          error: 'O Rclone finalizou mas nenhum token foi encontrado. Tente novamente.',
          proc: null
        };
        appendRcloneLog(googleDriveAuth.error, 'error');
      }
    } else {
      const errorMsg = output.trim() || `rclone exited with code ${code}`;
      googleDriveAuth = { status: 'error', error: errorMsg, proc: null };
      appendRcloneLog(`Falha na autorização: ${errorMsg}`, 'error');
    }
  });

  res.json({ status: 'browser_opened' });
});

/**
 * GET /api/cloud/auth/google-drive/status
 * Returns the current state of the OAuth flow.
 * The frontend polls this every 2s while pending.
 */
router.get('/auth/google-drive/status', async (_req, res) => {
  // If we think we succeeded, double-check the token still exists
  if (googleDriveAuth.status === 'success') {
    const tokenOk = await hasGoogleDriveToken();
    if (!tokenOk) {
      googleDriveAuth = { status: 'idle', error: null, proc: null };
      disableGoogleDriveConfig();
    }
  }

  res.json({
    status: googleDriveAuth.status,
    ...(googleDriveAuth.error ? { error: googleDriveAuth.error } : {})
  });
});

/**
 * DELETE /api/cloud/auth/google-drive
 * Disconnect Google Drive — removes rclone remote and disables cloud config.
 */
router.delete('/auth/google-drive', async (_req, res) => {
  // Kill in-flight auth if any
  if (googleDriveAuth.proc) {
    try { googleDriveAuth.proc.kill('SIGTERM'); } catch { /* ignore */ }
  }
  googleDriveAuth = { status: 'idle', error: null, proc: null };
  await rcloneConfigDelete(GOOGLE_DRIVE_REMOTE);
  disableGoogleDriveConfig();
  scheduleCloudSync(); // will clear the interval since enabled=false
  appendRcloneLog('Google Drive desconectado', 'info');
  res.json({ success: true });
});

/**
 * POST /api/cloud/config
 * Update cloud sync settings (remote_path, sync_interval_minutes).
 */
router.post('/config', async (req, res) => {
  try {
    const { remote_path, sync_interval_minutes } = req.body || {};
    const config = readConfig();
    const cloud = {
      ...(config.cloud || {}),
      provider: config.cloud?.provider || 'google_drive',
      remote_name: config.cloud?.remote_name || GOOGLE_DRIVE_REMOTE
    };

    if (remote_path !== undefined) cloud.remote_path = normalizeRemotePath(remote_path);
    if (sync_interval_minutes !== undefined) cloud.sync_interval_minutes = normalizeSyncInterval(sync_interval_minutes);

    config.cloud = cloud;
    writeConfig(config);
    scheduleCloudSync();
    res.json({ success: true, cloud: config.cloud });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
