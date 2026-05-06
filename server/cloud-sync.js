import { readConfig } from './utils.js';
import { getCloudStatusFromDb, recordCloudLog } from './db.js';
import { checkRemoteExists, rcloneBisync, rcloneVersion } from './rclone.js';
import { archiveAllEnabled } from './versioning.js';

let intervalHandle = null;
let debounceHandle = null;
let running = false;
let firstRun = true;

/**
 * Get the current cloud sync status for the API.
 * Checks both config.yaml state AND actual rclone remote existence.
 */
export async function getCloudStatus() {
  const config = readConfig();
  const dbStatus = getCloudStatusFromDb();
  const version = await rcloneVersion();
  const remoteName = config.cloud?.remote_name || 'savesync-gdrive';
  const remoteExists = version.ok ? await checkRemoteExists(remoteName) : false;

  return {
    connected: Boolean(config.cloud?.enabled) && version.ok && remoteExists,
    provider: config.cloud?.provider || null,
    remote_name: remoteName,
    remote_path: config.cloud?.remote_path || 'SaveSync/',
    sync_interval_minutes: config.cloud?.sync_interval_minutes || 5,
    last_sync: dbStatus.last_sync,
    files_synced: dbStatus.files_synced,
    rclone_installed: version.ok,
    rclone_version: version.ok ? (version.stdout || '').split('\n')[0]?.trim() : null,
    remote_exists: remoteExists,
    error: !version.ok
      ? 'Rclone não instalado ou não encontrado no PATH'
      : !remoteExists && config.cloud?.enabled
        ? 'Remote não encontrado no rclone config. Reconecte o Google Drive.'
        : dbStatus.error
  };
}

export async function testCloudRemote() {
  const { rcloneLsd } = await import('./rclone.js');
  return rcloneLsd();
}

/**
 * Execute a cloud bisync now.
 * On first run, uses --resync to establish baseline.
 */
export async function runCloudSyncNow({ resync = false, reason = 'manual' } = {}) {
  const config = readConfig();
  if (!config.cloud?.enabled) return { ok: false, error: 'Cloud sync disabled in config.yaml' };
  if (running) return { ok: false, error: 'Cloud sync already running' };

  // Verify remote still exists
  const remoteName = config.cloud?.remote_name || 'savesync-gdrive';
  const remoteOk = await checkRemoteExists(remoteName);
  if (!remoteOk) return { ok: false, error: `Remote "${remoteName}" não encontrado. Reconecte o Google Drive.` };

  running = true;

  // Archive all monitored saves to games/ before syncing to cloud
  const snapshot = archiveAllEnabled();
  if (snapshot.archived.length) {
    recordCloudLog(`Arquivados ${snapshot.archived.length} save(s) antes do bisync`, 'info');
  }

  const shouldResync = resync || firstRun;
  recordCloudLog(`Iniciando rclone bisync (motivo: ${reason}, resync: ${shouldResync})`, 'info');

  try {
    let result = await rcloneBisync({ resync: shouldResync });
    if (!result.ok && shouldRetryWithResync(result)) {
      recordCloudLog('Bisync precisa reconstruir o estado base. Tentando novamente com --resync.', 'warn');
      result = await rcloneBisync({ resync: true });
    }

    const fileCount = result.files_transferred || 0;

    if (result.ok) {
      firstRun = false;
      recordCloudLog('Rclone bisync completed', 'info', fileCount);
      return { ...result, files_transferred: fileCount };
    }

    recordCloudLog(`Bisync falhou: ${result.error}`, 'error');
    return result;
  } catch (error) {
    recordCloudLog(`Erro inesperado no bisync: ${error.message}`, 'error');
    return { ok: false, error: error.message };
  } finally {
    running = false;
  }
}

/**
 * Schedule periodic cloud sync based on config interval.
 */
export function scheduleCloudSync() {
  const config = readConfig();
  clearInterval(intervalHandle);
  intervalHandle = null;

  if (!config.cloud?.enabled) {
    console.log('[cloud-sync] Cloud sync disabled, interval cleared.');
    return;
  }

  const minutes = Math.max(1, Number(config.cloud?.sync_interval_minutes || 5));
  console.log(`[cloud-sync] Scheduling bisync every ${minutes} minute(s).`);
  intervalHandle = setInterval(() => {
    runCloudSyncNow({ reason: 'scheduled' }).catch(error => recordCloudLog(error.message, 'error'));
  }, minutes * 60 * 1000);
}

/**
 * Trigger a debounced cloud sync (called after file watcher events).
 * Waits 10 seconds to batch rapid changes.
 */
export function debounceCloudSync() {
  const config = readConfig();
  if (!config.cloud?.enabled) return;
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    runCloudSyncNow({ reason: 'watcher' }).catch(error => recordCloudLog(error.message, 'error'));
  }, 10_000);
}

function shouldRetryWithResync(result) {
  const text = `${result.error || ''}\n${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  return text.includes('empty prior') ||
    text.includes('retry without --resync') ||
    text.includes('cannot sync to an empty directory');
}
