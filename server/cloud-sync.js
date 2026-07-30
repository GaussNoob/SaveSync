import { ARCHIVE_ROOT, readConfig } from './utils.js';
import { getCloudStatusFromDb, listGames, recordCloudLog } from './db.js';
import {
  checkRemoteExists,
  isSupportedRcloneVersion,
  rcloneBisync,
  rcloneLsd,
  rcloneVersion
} from './rclone.js';
import { archiveAllEnabled } from './versioning.js';
import { scanForConflicts } from './conflicts.js';
import { withDataLock } from './sync-coordinator.js';
import { reconcileArchiveIndex } from './archive-index.js';

let intervalHandle = null;
let debounceHandle = null;
let inFlight = null;
let runtimeProbeCache = null;
let runtimeProbePromise = null;
const RUNTIME_PROBE_TTL_MS = 2_000;

export async function getCloudStatus() {
  const config = readConfig();
  const dbStatus = getCloudStatusFromDb();
  const remoteName = config.cloud?.remote_name || 'savesync-gdrive';
  const { version, supported, remoteExists } = await probeCloudRuntime(remoteName);
  return {
    connected: Boolean(config.cloud?.enabled) && supported && remoteExists,
    provider: config.cloud?.provider || null,
    remote_name: remoteName,
    remote_path: config.cloud?.remote_path || 'SaveSync/',
    sync_interval_minutes: config.cloud?.sync_interval_minutes || 5,
    last_sync: dbStatus.last_sync,
    files_synced: dbStatus.files_synced,
    sync_running: Boolean(inFlight),
    rclone_installed: version.ok,
    rclone_supported: supported,
    rclone_version: version.ok ? (version.stdout || '').split('\n')[0]?.trim() : null,
    remote_exists: remoteExists,
    error: !version.ok
      ? 'Rclone não instalado ou não encontrado no PATH'
      : !supported
        ? 'SaveSync requer rclone 1.71.0 ou mais recente.'
        : !remoteExists && config.cloud?.enabled
          ? 'Remote não encontrado no rclone config. Reconecte o Google Drive.'
          : dbStatus.error
  };
}

export async function testCloudRemote() {
  return rcloneLsd();
}

export function invalidateCloudStatusCache() {
  runtimeProbeCache = null;
}

export function runCloudSyncNow({ resync = false, reason = 'manual' } = {}) {
  if (inFlight) return Promise.resolve({ ok: false, error: 'Cloud sync already running' });
  inFlight = withDataLock(`cloud:${reason}`, () => performCloudSync({ resync, reason }))
    .finally(() => { inFlight = null; });
  return inFlight;
}

async function performCloudSync({ resync, reason }) {
  const config = readConfig();
  if (!config.cloud?.enabled) return { ok: false, error: 'Cloud sync disabled in config.yaml' };

  try {
    const version = await rcloneVersion();
    if (!version.ok) return { ok: false, error: 'Rclone não instalado ou não encontrado no PATH.' };
    if (!isSupportedRcloneVersion(version.stdout)) {
      return { ok: false, error: 'SaveSync requer rclone 1.71.0 ou mais recente.' };
    }

    const remoteName = config.cloud?.remote_name || 'savesync-gdrive';
    if (!await checkRemoteExists(remoteName)) {
      return { ok: false, error: `Remote "${remoteName}" não encontrado. Reconecte o Google Drive.` };
    }

    const snapshot = archiveAllEnabled({ skipUnchanged: true });
    if (snapshot.archived.length) {
      recordCloudLog(`Arquivados ${snapshot.archived.length} save(s) antes do bisync`, 'info');
    }
    if (snapshot.skipped.length) {
      recordCloudLog(`${snapshot.skipped.length} fonte(s) não puderam ser arquivadas antes do bisync.`, 'warn');
    }
    recordCloudLog(`Iniciando rclone bisync (motivo: ${reason}, resync explícito: ${resync})`, 'info');

    const result = await rcloneBisync({ resync });
    scanForConflicts([ARCHIVE_ROOT], listGames());
    const imported = reconcileArchiveIndex();
    if (imported.length) recordCloudLog(`Indexados ${imported.length} snapshot(s) recebido(s) da nuvem.`, 'info');
    const filesTransferred = result.files_transferred || 0;
    if (result.ok) {
      recordCloudLog('Rclone bisync completed', 'info', filesTransferred);
      return { ...result, files_transferred: filesTransferred };
    }

    const needsResync = requiresResync(result);
    const message = needsResync
      ? `${result.error || 'Bisync sem estado base.'} Confirme uma reconstrução explícita do baseline para continuar.`
      : result.error;
    recordCloudLog(`Bisync falhou: ${message}`, 'error');
    return { ...result, error: message, needs_resync: needsResync };
  } catch (error) {
    recordCloudLog(`Erro inesperado no bisync: ${error.message}`, 'error');
    return { ok: false, error: error.message };
  }
}

export function scheduleCloudSync() {
  const config = readConfig();
  clearInterval(intervalHandle);
  intervalHandle = null;
  if (!config.cloud?.enabled) {
    console.log('[cloud-sync] Cloud sync disabled, interval cleared.');
    return;
  }
  const configuredMinutes = Number(config.cloud?.sync_interval_minutes || 5);
  const minutes = Number.isFinite(configuredMinutes)
    ? Math.min(1440, Math.max(1, configuredMinutes))
    : 5;
  console.log(`[cloud-sync] Scheduling bisync every ${minutes} minute(s).`);
  intervalHandle = setInterval(() => {
    void runCloudSyncNow({ reason: 'scheduled' });
  }, minutes * 60 * 1000);
  intervalHandle.unref?.();
}

export function debounceCloudSync() {
  const config = readConfig();
  if (!config.cloud?.enabled || config.savesync?.sync_on_change === false) return;
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    void runCloudSyncNow({ reason: 'watcher' });
  }, 10_000);
  debounceHandle.unref?.();
}

export function stopCloudSyncSchedule() {
  clearInterval(intervalHandle);
  clearTimeout(debounceHandle);
  intervalHandle = null;
  debounceHandle = null;
}

function requiresResync(result) {
  const text = `${result.error || ''}\n${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  return text.includes('empty prior') ||
    text.includes('must run --resync') ||
    text.includes('cannot find prior') ||
    text.includes('.savesync-access') ||
    text.includes('check-access');
}

async function probeCloudRuntime(remoteName) {
  const now = Date.now();
  if (
    runtimeProbeCache?.remoteName === remoteName &&
    runtimeProbeCache.expiresAt > now
  ) {
    return runtimeProbeCache.value;
  }
  if (runtimeProbePromise?.remoteName === remoteName) return runtimeProbePromise.promise;

  const promise = (async () => {
    const version = await rcloneVersion();
    const supported = version.ok && isSupportedRcloneVersion(version.stdout);
    const remoteExists = supported ? await checkRemoteExists(remoteName) : false;
    const value = { version, supported, remoteExists };
    runtimeProbeCache = {
      remoteName,
      expiresAt: Date.now() + RUNTIME_PROBE_TTL_MS,
      value
    };
    return value;
  })().finally(() => {
    if (runtimeProbePromise?.promise === promise) runtimeProbePromise = null;
  });
  runtimeProbePromise = { remoteName, promise };
  return promise;
}
