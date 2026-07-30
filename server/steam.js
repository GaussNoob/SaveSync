import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandPath, pathExists } from './utils.js';

const NON_GAME_APP_IDS = new Set(['228980']);
const NON_GAME_NAMES = [
  /^steamworks common redistributables$/i,
  /^proton \d/i,
  /^steam linux runtime/i
];

export function parseVdf(content) {
  const tokens = [];
  const regex = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let match;
  while ((match = regex.exec(content))) {
    tokens.push(match[1] === undefined ? match[2] : decodeVdfString(match[1]));
  }
  let cursor = 0;

  function parseObject() {
    const object = {};
    while (cursor < tokens.length) {
      const key = tokens[cursor++];
      if (key === '}') break;
      if (tokens[cursor] === '{') {
        cursor += 1;
        object[key] = parseObject();
      } else {
        object[key] = tokens[cursor++];
      }
    }
    return object;
  }

  return parseObject();
}

export function getDefaultSteamPaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return uniquePaths([
      process.env.STEAM_PATH,
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam'
    ]);
  }
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Application Support', 'Steam')];
  }
  return [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam')
  ];
}

export function findSteamRoots(config = {}) {
  const configured = config.steam?.userdata_path
    ? [path.dirname(expandPath(config.steam.userdata_path))]
    : [];
  return uniquePaths([...configured, ...getDefaultSteamPaths()]).filter(pathExists);
}

export function readLibraryFolders(steamRoot) {
  const file = path.join(steamRoot, 'steamapps', 'libraryfolders.vdf');
  if (!pathExists(file)) return [path.join(steamRoot, 'steamapps')];
  try {
    const parsed = parseVdf(fs.readFileSync(file, 'utf8'));
    const folders = parsed.libraryfolders || {};
    const libraries = Object.values(folders)
      .filter(value => typeof value === 'object' && value.path)
      .map(value => path.join(value.path, 'steamapps'));
    return uniquePaths([path.join(steamRoot, 'steamapps'), ...libraries]).filter(pathExists);
  } catch (error) {
    console.warn(`Failed to parse ${file}: ${error.message}`);
    return [path.join(steamRoot, 'steamapps')];
  }
}

export function listInstalledSteamApps(config = {}) {
  const apps = new Map();
  for (const root of findSteamRoots(config)) {
    for (const steamapps of readLibraryFolders(root)) {
      for (const manifest of safeReaddir(steamapps).filter(name => /^appmanifest_\d+\.acf$/.test(name))) {
        const manifestPath = path.join(steamapps, manifest);
        try {
          const parsed = parseVdf(fs.readFileSync(manifestPath, 'utf8'));
          const state = parsed.AppState || parsed.appstate || {};
          if (!state.appid) continue;
          const name = state.name || `Steam App ${state.appid}`;
          if (isNonGameSteamApp(state.appid, name)) continue;
          apps.set(state.appid, {
            appid: state.appid,
            name,
            install_dir: state.installdir ? path.join(steamapps, 'common', state.installdir) : null,
            steamapps
          });
        } catch (error) {
          console.warn(`Failed to read Steam manifest ${manifestPath}: ${error.message}`);
        }
      }
    }
  }
  return [...apps.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function getSteamUserdataPaths(config = {}) {
  const configured = config.steam?.userdata_path ? [expandPath(config.steam.userdata_path)] : [];
  const discovered = findSteamRoots(config).map(root => path.join(root, 'userdata'));
  return uniquePaths([...configured, ...discovered]).filter(pathExists);
}

export function listSteamUsers(config = {}) {
  const users = [];
  for (const userdata of getSteamUserdataPaths(config)) {
    for (const entry of safeReaddir(userdata)) {
      const full = path.join(userdata, entry);
      if (/^\d+$/.test(entry) && pathExists(full)) users.push({ steamid: entry, userdata_path: full });
    }
  }
  return users;
}

export function readLocalConfig(userPath) {
  const file = path.join(userPath, 'config', 'localconfig.vdf');
  if (!pathExists(file)) return {};
  try {
    return parseVdf(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`Failed to parse ${file}: ${error.message}`);
    return {};
  }
}

export function getSteamCloudStatus(appid, config = {}) {
  let found = Boolean(findSteamCloudSavePath(appid, config));
  let enabled = false;
  for (const user of listSteamUsers(config)) {
    const localConfig = readLocalConfig(user.userdata_path);
    const apps = localConfig.UserLocalConfigStore?.Software?.Valve?.Steam?.Apps || {};
    const appConfig = apps[appid] || {};
    if (String(appConfig.Cloud || appConfig.cloud || '').toLowerCase() === '1') enabled = true;
  }
  return enabled ? 'enabled' : found ? 'available' : 'unknown';
}

export function findSteamCloudSavePath(appid, config = {}) {
  const safeAppId = String(appid || '');
  if (!/^\d{1,10}$/.test(safeAppId)) return null;
  const candidates = listSteamUsers(config)
    .map(user => path.join(user.userdata_path, safeAppId, 'remote'))
    .filter(pathExists)
    .map(candidate => ({
      path: candidate,
      modifiedAt: safeModifiedAt(candidate)
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.path || null;
}

export function disableSteamCloudForApp(appid, config = {}) {
  const safeAppId = String(appid || '');
  if (!/^\d{1,10}$/.test(safeAppId)) throw new Error('Steam appid inválido.');
  const changed = [];
  for (const user of listSteamUsers(config)) {
    const file = path.join(user.userdata_path, 'config', 'localconfig.vdf');
    if (!pathExists(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const appsRange = findNestedVdfObjectRange(content, ['UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'Apps']);
    if (!appsRange) continue;
    const appsContent = content.slice(appsRange.start, appsRange.end);
    const relativeAppRange = findVdfObjectRange(appsContent, safeAppId);
    if (!relativeAppRange) continue;
    const appStart = appsRange.start + relativeAppRange.start;
    const appEnd = appsRange.start + relativeAppRange.end;
    const appBlock = content.slice(appStart, appEnd);
    if (!/"Cloud"\s+"1"/.test(appBlock)) continue;
    const updatedBlock = appBlock.replace(/"Cloud"\s+"1"/, '"Cloud"\t\t"0"');
    const updated = `${content.slice(0, appStart)}${updatedBlock}${content.slice(appEnd)}`;
    if (updated !== content) {
      atomicReplaceTextFile(file, updated);
      changed.push(file);
    }
  }
  return changed;
}

function findNestedVdfObjectRange(content, keys) {
  let start = 0;
  let end = content.length;
  for (const key of keys) {
    const relative = findVdfObjectRange(content.slice(start, end), key);
    if (!relative) return null;
    const previousStart = start;
    start = previousStart + relative.start;
    end = previousStart + relative.end;
  }
  return { start, end };
}

function findVdfObjectRange(content, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escaped}"\\s*\\{`).exec(content);
  if (!match) return null;
  const openingBrace = content.indexOf('{', match.index);
  let depth = 0;
  let quoted = false;
  let escapedCharacter = false;
  for (let index = openingBrace; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (escapedCharacter) escapedCharacter = false;
      else if (character === '\\') escapedCharacter = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return { start: match.index, end: index + 1 };
  }
  return null;
}

function atomicReplaceTextFile(file, content) {
  const suffix = `${Date.now()}-${process.pid}`;
  const temporary = `${file}.savesync-${suffix}.tmp`;
  const backup = `${file}.savesync-${suffix}.bak`;
  const mode = fs.statSync(file).mode;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
  try {
    fs.renameSync(file, backup);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.renameSync(backup, file);
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function decodeVdfString(value) {
  return value.replace(/\\(["\\])/g, '$1');
}

function isNonGameSteamApp(appid, name) {
  return NON_GAME_APP_IDS.has(String(appid)) || NON_GAME_NAMES.some(pattern => pattern.test(name));
}

function uniquePaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    const normalized = path.resolve(value);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function safeModifiedAt(target) {
  try {
    return fs.statSync(target).mtimeMs;
  } catch {
    return 0;
  }
}
