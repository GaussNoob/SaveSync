import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expandPath, pathExists } from './utils.js';

export function parseVdf(content) {
  const tokens = [];
  const regex = /"((?:\\.|[^"\\])*)"|([{}])/g;
  let match;
  while ((match = regex.exec(content))) tokens.push(match[1] ?? match[2]);

  function parseObject() {
    const object = {};
    while (tokens.length) {
      const key = tokens.shift();
      if (key === '}') break;
      if (tokens[0] === '{') {
        tokens.shift();
        object[key] = parseObject();
      } else {
        object[key] = tokens.shift();
      }
    }
    return object;
  }

  return parseObject();
}

export function getDefaultSteamPaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam'
    ];
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
  return [...configured, ...getDefaultSteamPaths()].filter(pathExists);
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
    return [path.join(steamRoot, 'steamapps'), ...libraries].filter(pathExists);
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
          apps.set(state.appid, {
            appid: state.appid,
            name: state.name || `Steam App ${state.appid}`,
            install_dir: state.installdir ? path.join(steamapps, 'common', state.installdir) : null,
            steamapps
          });
        } catch (error) {
          console.warn(`Failed to read Steam manifest ${manifestPath}: ${error.message}`);
        }
      }
    }
  }
  return [...apps.values()];
}

export function getSteamUserdataPaths(config = {}) {
  const configured = config.steam?.userdata_path ? [expandPath(config.steam.userdata_path)] : [];
  const discovered = findSteamRoots(config).map(root => path.join(root, 'userdata'));
  return [...configured, ...discovered].filter(pathExists);
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
  let found = false;
  let enabled = false;
  for (const user of listSteamUsers(config)) {
    const remote = path.join(user.userdata_path, appid, 'remote');
    if (pathExists(remote)) found = true;
    const localConfig = readLocalConfig(user.userdata_path);
    const apps = localConfig.UserLocalConfigStore?.Software?.Valve?.Steam?.Apps || {};
    const appConfig = apps[appid] || {};
    if (String(appConfig.Cloud || appConfig.cloud || '').toLowerCase() === '1') enabled = true;
  }
  return enabled ? 'enabled' : found ? 'available' : 'unknown';
}

export function getProtonPrefixPath(appid) {
  const candidates = getDefaultSteamPaths().map(root =>
    path.join(root, 'steamapps', 'compatdata', String(appid), 'pfx')
  );
  return candidates.find(pathExists) || candidates[0];
}

export function disableSteamCloudForApp(appid, config = {}) {
  const changed = [];
  for (const user of listSteamUsers(config)) {
    const file = path.join(user.userdata_path, 'config', 'localconfig.vdf');
    if (!pathExists(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const appBlock = new RegExp(`("${appid}"\\s*\\{[\\s\\S]*?)(\\n\\s*\\})`, 'm');
    const updated = content.replace(appBlock, (block) => {
      if (/"Cloud"\s+"0"/.test(block)) return block;
      if (/"Cloud"\s+"1"/.test(block)) return block.replace(/"Cloud"\s+"1"/, '"Cloud"\t\t"0"');
      return block.replace(/\n\s*\}$/, '\n\t\t\t\t\t"Cloud"\t\t"0"\n\t\t\t\t}');
    });
    if (updated !== content) {
      fs.copyFileSync(file, `${file}.savesync.bak`);
      fs.writeFileSync(file, updated);
      changed.push(file);
    }
  }
  return changed;
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
