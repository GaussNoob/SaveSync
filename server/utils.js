import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

export const APP_ROOT = path.resolve(process.cwd());
export const CONFIG_PATH = path.join(APP_ROOT, 'config.yaml');
export const DATA_ROOT = process.env.SAVESYNC_DATA_DIR || path.join(os.homedir(), 'savesync');
export const ARCHIVE_ROOT = path.join(DATA_ROOT, 'games');
export const CONFLICT_ROOT = path.join(DATA_ROOT, 'conflicts');

export function readConfig() {
  try {
    return YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch (error) {
    console.warn(`config.yaml unavailable, using defaults: ${error.message}`);
    return {};
  }
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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
