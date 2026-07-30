import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROOT = path.resolve(MODULE_DIR, '..');
export const CONFIG_PATH = path.resolve(process.env.SAVESYNC_CONFIG || path.join(APP_ROOT, 'config.yaml'));
export const DATA_ROOT = process.env.SAVESYNC_DATA_DIR || path.join(os.homedir(), 'savesync');
export const ARCHIVE_ROOT = path.join(DATA_ROOT, 'games');
export const CONFLICT_ROOT = path.join(DATA_ROOT, 'conflicts');
export const STAGING_ROOT = path.join(ARCHIVE_ROOT, '.savesync-staging');

const DEFAULT_CONFIG = Object.freeze({
  server: { host: '127.0.0.1', allowed_origins: [] },
  savesync: {
    version_limit: 10,
    sync_on_change: true,
    notify_desktop: true,
    scan_on_startup: true
  },
  syncthing: { enabled: false, api_url: 'http://localhost:8384', folder_id: 'savesync-folder' },
  cloud: { enabled: false }
});
let configCache = null;

export function readConfig() {
  const signature = getConfigSignature();
  if (configCache?.signature === signature) return structuredClone(configCache.value);

  try {
    const parsed = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    if (!isPlainObject(parsed)) throw new Error('A raiz do config.yaml deve ser um mapa YAML.');
    const config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      server: { ...DEFAULT_CONFIG.server, ...asPlainObject(parsed.server) },
      savesync: { ...DEFAULT_CONFIG.savesync, ...asPlainObject(parsed.savesync) },
      syncthing: { ...DEFAULT_CONFIG.syncthing, ...asPlainObject(parsed.syncthing) },
      cloud: { ...DEFAULT_CONFIG.cloud, ...asPlainObject(parsed.cloud) }
    };
    configCache = { signature, value: structuredClone(config) };
    return config;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`config.yaml unavailable, using defaults: ${error.message}`);
    const fallback = structuredClone(DEFAULT_CONFIG);
    configCache = { signature, value: structuredClone(fallback) };
    return fallback;
  }
}

export function writeConfig(config) {
  ensureDir(path.dirname(CONFIG_PATH));
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  const serialized = YAML.stringify(config);
  try {
    fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, CONFIG_PATH);
    if (process.platform !== 'win32') fs.chmodSync(CONFIG_PATH, 0o600);
    configCache = {
      signature: getConfigSignature(),
      value: structuredClone(config)
    };
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function ensureArchiveControlFiles() {
  ensureDir(ARCHIVE_ROOT);
  ensureDir(STAGING_ROOT);
  const ignorePath = path.join(ARCHIVE_ROOT, '.stignore');
  const requiredRule = '(?d).savesync-staging';
  let content = '';
  try { content = fs.readFileSync(ignorePath, 'utf8'); } catch { /* create below */ }
  if (!content.split(/\r?\n/).includes(requiredRule)) {
    const next = `${content.trimEnd()}${content.trim() ? '\n' : ''}${requiredRule}\n`;
    const temporary = `${ignorePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, next, 'utf8');
    fs.renameSync(temporary, ignorePath);
  }
  return ignorePath;
}

export function expandPath(input) {
  if (!input) return input;
  let value = String(input);
  const home = os.homedir();
  const replacements = {
    '%APPDATA%': process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    '%LOCALAPPDATA%': process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    '%USERPROFILE%': process.env.USERPROFILE || home,
    '%DOCUMENTS%': path.join(process.env.USERPROFILE || home, 'Documents')
  };

  for (const [token, replacement] of Object.entries(replacements)) {
    value = value.replaceAll(token, replacement);
  }
  if (value.startsWith('~')) value = path.join(home, value.slice(1));
  return path.normalize(value);
}

export function pathExists(target) {
  try {
    fs.accessSync(target, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function getPlatformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

export function safeStat(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

export function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function normalizeGameId(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getConfigSignature() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function asPlainObject(value) {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
