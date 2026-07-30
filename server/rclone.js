import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARCHIVE_ROOT, DATA_ROOT, ensureArchiveControlFiles, ensureDir, readConfig } from './utils.js';
import { recordCloudLogs } from './db.js';
import { broadcastRcloneLog } from './websocket.js';

const MAX_LOG_LINES = 100;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const ACCESS_MARKER = '.savesync-access';
const memoryLog = [];
const activeProcesses = new Set();
const pendingPersistentLogs = [];
let persistentLogTimer = null;
let cachedRcloneBin = null;

function getRcloneBin() {
  if (cachedRcloneBin) return cachedRcloneBin;
  const executable = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    process.env.RCLONE_BIN,
    path.join(process.cwd(), 'resources', 'rclone', executable),
    path.join(process.cwd(), 'vendor', 'rclone', executable),
    process.platform === 'win32' && path.join(localAppData, 'Microsoft', 'WinGet', 'Links', executable),
    ...findWingetRcloneCandidates(localAppData, executable),
    process.platform === 'win32' && path.join(os.homedir(), 'scoop', 'shims', executable),
    process.platform === 'win32' && path.join(programFiles, 'rclone', executable),
    path.join(os.homedir(), '.local', 'bin', 'rclone'),
    path.join(os.homedir(), 'bin', 'rclone'),
    '/usr/local/bin/rclone',
    '/usr/bin/rclone',
    'rclone'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'rclone') {
      cachedRcloneBin = candidate;
      return cachedRcloneBin;
    }
    try {
      if (fs.existsSync(candidate)) {
        cachedRcloneBin = candidate;
        return cachedRcloneBin;
      }
    } catch { /* try the next candidate */ }
  }
  cachedRcloneBin = 'rclone';
  return cachedRcloneBin;
}

function findWingetRcloneCandidates(localAppData, executable) {
  if (process.platform !== 'win32') return [];
  const packagesRoot = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  try {
    const candidates = [];
    for (const packageEntry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!packageEntry.isDirectory() || !packageEntry.name.startsWith('Rclone.Rclone_')) continue;
      const packagePath = path.join(packagesRoot, packageEntry.name);
      candidates.push(path.join(packagePath, executable));
      for (const childEntry of fs.readdirSync(packagePath, { withFileTypes: true })) {
        if (childEntry.isDirectory()) candidates.push(path.join(packagePath, childEntry.name, executable));
      }
    }
    return candidates;
  } catch {
    return [];
  }
}

export function getRcloneConfigPath() {
  const target = path.resolve(
    process.env.SAVESYNC_RCLONE_CONFIG || path.join(DATA_ROOT, 'rclone', 'rclone.conf')
  );
  ensureDir(path.dirname(target));
  if (!fs.existsSync(target)) {
    const legacy = process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'rclone', 'rclone.conf')
      : path.join(os.homedir(), '.config', 'rclone', 'rclone.conf');
    if (path.resolve(legacy) !== target && fs.existsSync(legacy)) fs.copyFileSync(legacy, target);
  }
  secureRcloneConfig(target);
  return target;
}

export function getRcloneLog() {
  return memoryLog.slice(-MAX_LOG_LINES);
}

export function appendRcloneLog(line, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, message: String(line).slice(0, 4000) };
  memoryLog.push(entry);
  while (memoryLog.length > MAX_LOG_LINES) memoryLog.shift();
  pendingPersistentLogs.push({ message: entry.message, level });
  if (pendingPersistentLogs.length >= 100) flushPersistentLogs();
  else if (!persistentLogTimer) {
    persistentLogTimer = setTimeout(flushPersistentLogs, 250);
    persistentLogTimer.unref?.();
  }
  broadcastRcloneLog(entry);
}

/** Execute rclone without a shell, with bounded output and a hard timeout. */
export function runRclone(args, options = {}) {
  return new Promise(resolve => {
    const safeArgs = args.map(argument => {
      const value = String(argument);
      if (value.includes('\0')) throw new Error('Argumento rclone contém byte nulo.');
      return value;
    });
    const configPath = options.configPath || getRcloneConfigPath();
    const env = {
      ...process.env,
      RCLONE_CONFIG: configPath,
      RCLONE_CACHE_DIR: process.env.RCLONE_CACHE_DIR || ensureDir(path.join(DATA_ROOT, 'rclone-cache'))
    };
    const child = spawn(getRcloneBin(), safeArgs, {
      cwd: options.cwd || process.cwd(),
      env,
      windowsHide: true,
      shell: false
    });
    activeProcesses.add(child);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let emittedLines = 0;
    let logTruncated = false;
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    timeout.unref();

    const finish = (code, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      activeProcesses.delete(child);
      secureRcloneConfig(configPath);
      flushPersistentLogs();
      const ok = code === 0 && !error && !timedOut;
      const message = timedOut
        ? `rclone excedeu o limite de ${Math.round(timeoutMs / 1000)} segundos`
        : error?.message || (ok ? null : stderr || `exit ${code}`);
      if (!ok && !options.silent) appendRcloneLog(message, 'error');
      resolve({ ok, code: code ?? -1, stdout, stderr, error: message, timed_out: timedOut });
    };

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout = appendBounded(stdout, text);
      if (!options.silent) emitProcessLines(text, 'info');
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr = appendBounded(stderr, text);
      if (!options.silent) emitProcessLines(text, 'warn');
    });
    child.once('error', error => finish(-1, error));
    child.once('close', code => finish(code));

    function emitProcessLines(text, level) {
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        if (emittedLines < 2_000) {
          appendRcloneLog(line, level);
          emittedLines += 1;
        } else if (!logTruncated) {
          appendRcloneLog('Saída do processo rclone truncada após 2000 linhas.', 'warn');
          logTruncated = true;
        }
      }
    }
  });
}

export async function rcloneVersion() {
  return runRclone(['--version'], { silent: true, timeoutMs: 15_000 });
}

export function parseRcloneVersion(output) {
  const match = String(output || '').match(/rclone v(\d+)\.(\d+)(?:\.(\d+))?/i);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) } : null;
}

/**
 * Rclone prints a loopback URL when its automatic browser launch is unavailable.
 * Only return loopback URLs so arbitrary process output can never become a link
 * that the dashboard is allowed to open.
 */
export function extractRcloneOAuthUrl(output) {
  const matches = String(output || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  for (const candidate of matches) {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''));
      const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
      if (url.protocol === 'http:' && isLoopback && url.pathname.startsWith('/auth')) return url.href;
    } catch {
      // Ignore malformed URLs and keep looking through the process output.
    }
  }
  return null;
}

export function isSupportedRcloneVersion(output, minimum = { major: 1, minor: 71, patch: 0 }) {
  const current = parseRcloneVersion(output);
  if (!current) return false;
  return [current.major, current.minor, current.patch].join('.').localeCompare(
    [minimum.major, minimum.minor, minimum.patch].join('.'),
    undefined,
    { numeric: true }
  ) >= 0;
}

export async function rcloneLsd(remote = null) {
  const config = readConfig();
  const target = remote || `${normalizeRemoteName(config.cloud?.remote_name || 'savesync-remote')}:`;
  return runRclone(['lsd', target], { timeoutMs: 60_000 });
}

export function authorizeGoogleDrive(options = {}) {
  const remoteName = normalizeRemoteName(options.remoteName || 'savesync-gdrive');
  const configPath = getRcloneConfigPath();
  appendRcloneLog(`Iniciando OAuth para Google Drive (remote: ${remoteName})`, 'info');
  const proc = spawn(getRcloneBin(), [
    'config', 'create', remoteName, 'drive', 'config_is_local=true'
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RCLONE_CONFIG: configPath,
      RCLONE_CACHE_DIR: process.env.RCLONE_CACHE_DIR || ensureDir(path.join(DATA_ROOT, 'rclone-cache'))
    },
    windowsHide: true,
    shell: false
  });
  activeProcesses.add(proc);
  proc.once('error', () => activeProcesses.delete(proc));
  proc.once('close', () => {
    activeProcesses.delete(proc);
    secureRcloneConfig(configPath);
  });
  return proc;
}

export async function rcloneConfigDelete(remoteName = 'savesync-gdrive') {
  return runRclone(['config', 'delete', normalizeRemoteName(remoteName)], { silent: true, timeoutMs: 60_000 });
}

export async function rcloneConfigShow(remoteName = 'savesync-gdrive') {
  return runRclone(['config', 'show', normalizeRemoteName(remoteName)], { silent: true, timeoutMs: 60_000 });
}

export async function rcloneAboutJson(remoteName = 'savesync-gdrive') {
  return runRclone(['about', `${normalizeRemoteName(remoteName)}:`, '--json'], { silent: true, timeoutMs: 60_000 });
}

export async function checkRemoteExists(remoteName = 'savesync-gdrive') {
  const normalized = normalizeRemoteName(remoteName);
  const result = await runRclone(['listremotes'], { silent: true, timeoutMs: 30_000 });
  if (!result.ok) return false;
  const remotes = result.stdout.split(/\r?\n/).map(item => item.trim().replace(/:$/, ''));
  return remotes.includes(normalized);
}

export async function rcloneBisync({ resync = false } = {}) {
  const config = readConfig();
  const remoteName = normalizeRemoteName(config.cloud?.remote_name || 'savesync-gdrive');
  const remotePath = normalizeRemotePath(config.cloud?.remote_path || 'SaveSync/');
  ensureArchiveControlFiles();
  const localPath = path.resolve(ensureDir(ARCHIVE_ROOT));
  const remoteTarget = `${remoteName}:${remotePath}`;
  const mkdir = await runRclone(['mkdir', remoteTarget], { silent: true, timeoutMs: 60_000 });
  if (!mkdir.ok) return mkdir;
  const localMarker = path.join(localPath, ACCESS_MARKER);
  if (!fs.existsSync(localMarker)) fs.writeFileSync(localMarker, 'SaveSync access check\n', 'utf8');
  if (resync) {
    const markerUpload = await runRclone(
      ['copyto', localMarker, `${remoteTarget}${ACCESS_MARKER}`],
      { silent: true, timeoutMs: 60_000 }
    );
    if (!markerUpload.ok) return markerUpload;
  }

  const args = buildRcloneBisyncArgs(config, { localPath, remoteTarget, resync });
  const result = await runRclone(args, { timeoutMs: DEFAULT_TIMEOUT_MS });
  result.files_transferred = parseTransferredCount(`${result.stderr}\n${result.stdout}`);
  return result;
}

export function buildRcloneBisyncArgs(config, { localPath = ARCHIVE_ROOT, remoteTarget, resync = false } = {}) {
  const target = remoteTarget || `${normalizeRemoteName(config.cloud?.remote_name || 'savesync-gdrive')}:${normalizeRemotePath(config.cloud?.remote_path || 'SaveSync/')}`;
  const conflictMode = config.cloud?.on_conflict === 'keep_both'
    ? ['--conflict-resolve', 'none', '--conflict-loser', 'num']
    : ['--conflict-resolve', 'newer'];
  const maxDelete = Math.min(50, Math.max(1, Math.floor(Number(config.cloud?.max_delete_percent || 10))));
  const args = [
    'bisync', path.resolve(localPath), target,
    '--resilient', '--recover', '--create-empty-src-dirs',
    '--check-access', '--check-filename', ACCESS_MARKER,
    '--exclude', '/.savesync-staging/**',
    '--exclude', '/.stfolder/**',
    '--exclude', '/.stignore',
    '--max-delete', String(maxDelete), '--max-lock', '2m', '-v',
    ...conflictMode
  ];
  if (resync) args.push('--resync');
  return args;
}

export function terminateRcloneProcesses() {
  for (const processHandle of activeProcesses) {
    try { processHandle.kill('SIGTERM'); } catch { /* best effort */ }
  }
  flushPersistentLogs();
}

function normalizeRemoteName(input) {
  const value = String(input || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) throw new Error('Nome de remote rclone inválido.');
  return value;
}

function normalizeRemotePath(input) {
  const value = String(input || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (!value || value.length > 512 || /[\0\r\n]/.test(value)) throw new Error('Caminho remoto rclone inválido.');
  if (value.split('/').some(segment => segment === '..')) throw new Error('Caminho remoto rclone não pode conter "..".');
  return value.endsWith('/') ? value : `${value}/`;
}

function secureRcloneConfig(configPath) {
  if (process.platform === 'win32' || !fs.existsSync(configPath)) return;
  try { fs.chmodSync(configPath, 0o600); } catch { /* best effort */ }
}

function appendBounded(current, incoming) {
  const combined = current + incoming;
  if (Buffer.byteLength(combined) <= MAX_CAPTURE_BYTES) return combined;
  return `[output truncated]\n${combined.slice(-MAX_CAPTURE_BYTES)}`;
}

function parseTransferredCount(output) {
  const matches = [...String(output || '').matchAll(/Transferred:\s+(\d+)\s*\/\s*\d+,/g)];
  return matches.length ? Number(matches.at(-1)[1]) : 0;
}

function flushPersistentLogs() {
  clearTimeout(persistentLogTimer);
  persistentLogTimer = null;
  if (!pendingPersistentLogs.length) return;
  const entries = pendingPersistentLogs.splice(0, pendingPersistentLogs.length);
  try {
    recordCloudLogs(entries);
  } catch (error) {
    console.warn(`Não foi possível persistir ${entries.length} log(s) do rclone: ${error.message}`);
  }
}
