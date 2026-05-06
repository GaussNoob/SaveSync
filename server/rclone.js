import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_ROOT, ensureDir, readConfig } from './utils.js';
import { recordCloudLog } from './db.js';
import { broadcastRcloneLog } from './websocket.js';

const MAX_LOG_LINES = 100;
const memoryLog = [];

/**
 * Resolve the rclone binary path.
 * Checks common user-local paths before falling back to PATH lookup.
 */
function getRcloneBin() {
  const candidates = [
    process.env.RCLONE_BIN,
    path.join(os.homedir(), '.local', 'bin', 'rclone'),
    path.join(os.homedir(), 'bin', 'rclone'),
    '/usr/local/bin/rclone',
    '/usr/bin/rclone',
    'rclone'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'rclone') return candidate; // fallback to PATH
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }
  return 'rclone';
}

export function getRcloneLog() {
  return memoryLog.slice(-MAX_LOG_LINES);
}

export function appendRcloneLog(line, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, message: String(line) };
  memoryLog.push(entry);
  while (memoryLog.length > MAX_LOG_LINES) memoryLog.shift();
  recordCloudLog(entry.message, level);
  broadcastRcloneLog(entry);
}

/**
 * Run an rclone command and return a promise with the result.
 */
export function runRclone(args, options = {}) {
  return new Promise((resolve) => {
    const bin = getRcloneBin();
    const env = { ...process.env };
    if (options.configPath) env.RCLONE_CONFIG = options.configPath;

    const child = spawn(bin, args, {
      cwd: options.cwd || process.cwd(),
      env
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (!options.silent) text.split(/\r?\n/).filter(Boolean).forEach(line => appendRcloneLog(line, 'info'));
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      if (!options.silent) text.split(/\r?\n/).filter(Boolean).forEach(line => appendRcloneLog(line, 'warn'));
    });
    child.on('error', error => {
      if (!options.silent) appendRcloneLog(error.message, 'error');
      resolve({ ok: false, code: -1, stdout, stderr, error: error.message });
    });
    child.on('close', code => {
      const ok = code === 0;
      if (!ok && !options.silent) appendRcloneLog(`rclone exited with code ${code}`, 'error');
      resolve({ ok, code, stdout, stderr, error: ok ? null : stderr || `exit ${code}` });
    });
  });
}

export async function rcloneVersion() {
  return runRclone(['--version'], { silent: true });
}

export async function rcloneLsd(remote = null) {
  const config = readConfig();
  const target = remote || `${config.cloud?.remote_name || 'savesync-remote'}:`;
  return runRclone(['lsd', target]);
}

export async function rcloneConfigCreate(provider, remoteName = 'savesync-remote') {
  return runRclone(['config', 'create', remoteName, provider]);
}

/**
 * Start the Google Drive OAuth flow.
 *
 * `config_is_local=true` is passed as a config **parameter** to `rclone config create`.
 * This tells rclone that a browser IS available locally, so it should:
 *   1. Spin up an HTTP server on localhost:53682
 *   2. Open the user's default browser to Google's OAuth consent screen
 *   3. Receive the callback token on localhost:53682
 *   4. Save the token to rclone.conf
 *
 * We do NOT use `--non-interactive` because that causes rclone to skip the
 * browser-based OAuth entirely and exit immediately without a token.
 */
export function authorizeGoogleDrive(options = {}) {
  const remoteName = options.remoteName || 'savesync-gdrive';
  const bin = getRcloneBin();

  appendRcloneLog(`Iniciando OAuth para Google Drive (remote: ${remoteName})`, 'info');

  const proc = spawn(bin, [
    'config', 'create', remoteName, 'drive',
    'config_is_local=true'
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return proc;
}

export async function rcloneConfigDelete(remoteName = 'savesync-gdrive') {
  return runRclone(['config', 'delete', remoteName], { silent: true });
}

export async function rcloneConfigShow(remoteName = 'savesync-gdrive') {
  return runRclone(['config', 'show', remoteName], { silent: true });
}

export async function rcloneAboutJson(remoteName = 'savesync-gdrive') {
  return runRclone(['about', `${remoteName}:`, '--json'], { silent: true });
}

/**
 * Check if a remote exists in the rclone config.
 */
export async function checkRemoteExists(remoteName = 'savesync-gdrive') {
  const result = await runRclone(['listremotes'], { silent: true });
  if (!result.ok) return false;
  const remotes = result.stdout.split(/\r?\n/).map(r => r.trim().replace(/:$/, ''));
  return remotes.includes(remoteName);
}

/**
 * List all configured rclone remotes.
 */
export async function rcloneListRemotes() {
  const result = await runRclone(['listremotes'], { silent: true });
  if (!result.ok) return [];
  return result.stdout.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
}

export async function rcloneBisync({ resync = false } = {}) {
  const config = readConfig();
  const remoteName = config.cloud?.remote_name || 'savesync-gdrive';
  const remotePath = config.cloud?.remote_path || 'SaveSync/';
  const localPath = config.cloud?.local_path || path.join(DATA_ROOT, 'games');

  // Bisync requires both directories to exist before running.
  ensureDir(path.resolve(localPath));
  await runRclone(['mkdir', `${remoteName}:${remotePath}`], { silent: true });

  const conflictMode = config.cloud?.on_conflict === 'keep_both'
    ? ['--conflict-resolve', 'none', '--conflict-loser', 'num']
    : ['--conflict-resolve', 'newer'];
  const args = [
    'bisync',
    path.resolve(localPath),
    `${remoteName}:${remotePath}`,
    '--resilient',
    '--recover',
    '--create-empty-src-dirs',
    '--force',
    '-v',
    ...conflictMode
  ];
  if (resync) args.push('--resync');
  const result = await runRclone(args);

  // Parse transferred file count from rclone verbose output
  result.files_transferred = parseTransferredCount(result.stderr + '\n' + result.stdout);
  return result;
}

/**
 * Parse the number of transferred files from rclone's verbose output.
 * Looks for lines like "Transferred:   5 / 5, 100%" in stderr.
 */
function parseTransferredCount(output) {
  if (!output) return 0;
  // Match "Transferred:  N / TOTAL" pattern (files line, not bytes)
  // Example: "Transferred:            5 / 5, 100%"
  const match = output.match(/Transferred:\s+(\d+)\s*\/\s*\d+,/);
  return match ? Number(match[1]) : 0;
}
