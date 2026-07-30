import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandPath, getPlatformKey, normalizeGameId, pathExists, readConfig, safeStat } from './utils.js';
import { getSteamCloudStatus, listInstalledSteamApps } from './steam.js';
import { listGames } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const knownGames = JSON.parse(fs.readFileSync(path.join(__dirname, 'known-games.json'), 'utf8'));

const emulatorDefaults = [
  {
    name: 'RetroArch',
    platform: 'emulator',
    saves_path: {
      windows: '%APPDATA%\\RetroArch\\saves',
      linux: '~/.config/retroarch/saves',
      mac: '~/Library/Application Support/RetroArch/saves'
    },
    states_path: {
      windows: '%APPDATA%\\RetroArch\\states',
      linux: '~/.config/retroarch/states',
      mac: '~/Library/Application Support/RetroArch/states'
    },
    extensions: ['.srm', '.sav', '.state', '.state.auto']
  },
  {
    name: 'Dolphin',
    platform: 'emulator',
    saves_path: {
      windows: ['%APPDATA%\\Dolphin Emulator', '%DOCUMENTS%\\Dolphin Emulator'],
      linux: ['~/.local/share/dolphin-emu', '~/.dolphin-emu', '~/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu'],
      mac: '~/Library/Application Support/Dolphin'
    },
    extensions: ['.gci', '.raw', '.bin', '.sav']
  },
  {
    name: 'Yuzu',
    platform: 'emulator',
    saves_path: {
      windows: '%APPDATA%\\yuzu\\nand\\user\\save',
      linux: ['~/.local/share/yuzu/nand/user/save', '~/.var/app/org.yuzu_emu.yuzu/data/yuzu/nand/user/save'],
      mac: ['~/Library/Application Support/yuzu/nand/user/save', '~/.local/share/yuzu/nand/user/save']
    },
    extensions: [],
    save_type: 'directory'
  },
  {
    name: 'Eden',
    platform: 'emulator',
    saves_path: {
      windows: '%APPDATA%\\Eden\\nand\\user\\save',
      linux: ['~/.local/share/eden/nand/user/save', '~/.var/app/dev.eden_emu.eden/data/eden/nand/user/save'],
      mac: ['~/Library/Application Support/eden/nand/user/save', '~/.local/share/eden/nand/user/save']
    },
    extensions: [],
    save_type: 'directory'
  },
  {
    name: 'Ryujinx',
    platform: 'emulator',
    saves_path: {
      windows: '%APPDATA%\\Ryujinx\\bis\\user\\save',
      linux: ['~/.config/Ryujinx/bis/user/save', '~/.var/app/org.ryujinx.Ryujinx/config/Ryujinx/bis/user/save'],
      mac: '~/Library/Application Support/Ryujinx/bis/user/save'
    },
    extensions: [],
    save_type: 'directory'
  },
  {
    name: 'Cemu',
    platform: 'emulator',
    saves_path: {
      windows: ['%USERPROFILE%\\Documents\\Cemu\\mlc01\\usr\\save', '%USERPROFILE%\\Documents\\mlc01\\usr\\save'],
      linux: ['~/.local/share/Cemu/mlc01/usr/save', '~/.var/app/info.cemu.Cemu/data/Cemu/mlc01/usr/save'],
      mac: '~/Library/Application Support/Cemu/mlc01/usr/save'
    },
    extensions: [],
    save_type: 'directory'
  },
  { name: 'PCSX2', platform: 'emulator', saves_path: '~/Documents/PCSX2/memcards', extensions: ['.ps2'] },
  { name: 'RPCS3', platform: 'emulator', saves_path: '~/Documents/rpcs3/dev_hdd0/home/00000001/savedata', extensions: [], save_type: 'directory' },
  { name: 'MAME', platform: 'emulator', saves_path: '~/.mame/nvram', states_path: '~/.mame/sta', extensions: ['.nv', '.sta'] },
  { name: 'DeSmuME', platform: 'emulator', saves_path: '~/.config/desmume', extensions: ['.dsv', '.ds1'] },
  { name: 'melonDS', platform: 'emulator', saves_path: '~/.config/melonDS', extensions: ['.sav', '.mln'] },
  { name: 'PPSSPP', platform: 'emulator', saves_path: '~/.config/ppsspp/PSP/SAVEDATA', extensions: [], save_type: 'directory' },
  { name: 'SNES9x', platform: 'emulator', saves_path: '~/.snes9x', extensions: ['.srm', '.frz'] },
  { name: 'VisualBoyAdvance', platform: 'emulator', saves_path: '~/.visualboyadvance', extensions: ['.sav', '.sgm'] }
];

export function scanSystem(config = readConfig()) {
  const results = [];
  const platform = getPlatformKey();
  const installedSteam = new Map(listInstalledSteamApps(config).map(app => [String(app.appid), app]));

  for (const game of knownGames) {
    const configuredPath = getSavePathForCurrentPlatform(game, platform);
    const sourcePath = expandPath(configuredPath);
    const installed = game.steam_appid ? installedSteam.has(String(game.steam_appid)) : false;
    const detected = game.steam_appid ? installed : pathExists(sourcePath);
    if (sourcePath && detected) {
      results.push({
        id: game.id,
        name: game.name,
        platform: game.platform || 'pc',
        steam_appid: game.steam_appid || null,
        source_path: sourcePath,
        extensions: game.extensions || [],
        save_type: game.save_type || 'file',
        cloud_save: Boolean(game.cloud_save),
        cloud_status: game.steam_appid ? getSteamCloudStatus(game.steam_appid, config) : 'unknown',
        enabled: false,
        detected
      });
    }
  }

  for (const emulator of [...emulatorDefaults, ...(config.emulators || [])]) {
    for (const key of ['saves_path', 'states_path']) {
      const sourcePath = getExistingEmulatorPath(emulator, key, platform);
      if (!pathExists(sourcePath)) continue;
      results.push({
        id: `${normalizeGameId(emulator.name)}-${key.replace('_path', '')}`,
        name: `${emulator.name} ${key === 'states_path' ? 'States' : 'Saves'}`,
        platform: 'emulator',
        source_path: sourcePath,
        extensions: emulator.extensions || [],
        save_type: emulator.save_type || 'file',
        cloud_save: false,
        cloud_status: 'not_applicable',
        enabled: false,
        detected: true
      });
    }
  }

  for (const custom of config.custom_games || []) {
    const sourcePath = expandPath(custom.saves_path || custom.path);
    if (!sourcePath) continue;
    results.push({
      id: custom.id || normalizeGameId(custom.name),
      name: custom.name,
      platform: custom.platform || 'custom',
      source_path: sourcePath,
      extensions: custom.extensions || [],
      save_type: custom.save_type || 'file',
      cloud_save: Boolean(custom.cloud_save),
      cloud_status: 'manual',
      enabled: false,
      detected: pathExists(sourcePath)
    });
  }

  return dedupeById(results);
}

export function searchKnownGames(query = '') {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  return knownGames
    .filter(game => {
      const haystack = [
        game.name,
        game.id,
        game.platform,
        ...(game.search_aliases || [])
      ].join(' ');
      return normalizeSearch(haystack).includes(normalized);
    })
    .slice(0, 12)
    .map(publicKnownGame);
}

export function detectKnownGame(gameId) {
  const game = knownGames.find(item => item.id === gameId);
  if (!game) return null;
  const expectedPath = expandPath(getSavePathForCurrentPlatform(game));
  return {
    found: pathExists(expectedPath),
    path: expectedPath,
    game: publicKnownGame(game),
    extensions_found: pathExists(expectedPath) ? findExtensions(expectedPath) : []
  };
}

export function scanLaunchers(config = readConfig()) {
  const detected = scanSystem(config);
  const monitored = new Set(listGames().map(game => game.id));
  return detected.map(game => ({
    name: game.name,
    id: game.id,
    platform: game.platform,
    steam_appid: game.steam_appid || null,
    save_path: game.source_path,
    source_path: game.source_path,
    extensions: game.extensions || [],
    save_type: game.save_type || 'file',
    found_in_system: pathExists(game.source_path),
    already_monitored: monitored.has(game.id),
    cloud_save: game.cloud_save,
    cloud_status: game.cloud_status
  }));
}

export function identifySavePath(inputPath) {
  const target = expandPath(inputPath);
  if (!target) return { suggested_game: null, extensions_found: [] };
  const extensions = pathExists(target) ? findExtensions(target) : [];
  const base = normalizeSearch(path.basename(target || ''));
  const full = normalizeSearch(target);
  const compactFull = compactSearch(target);
  const compactBase = compactSearch(base);
  const scored = knownGames.map(game => {
    const names = normalizeSearch([game.name, game.id, ...(game.search_aliases || [])].join(' '));
    const compactNames = compactSearch([game.name, game.id, ...(game.search_aliases || [])].join(' '));
    const extScore = (game.extensions || []).some(ext => extensions.includes(String(ext).toLowerCase())) ? 1 : 0;
    let score = extScore;
    if (names.includes(base) || base.includes(normalizeSearch(game.name))) score += 10;
    if (full.includes(normalizeSearch(game.id)) || full.includes(normalizeSearch(game.name))) score += 8;
    if (compactFull.includes(compactNames) || (compactBase.length >= 3 && compactNames.includes(compactBase))) score += 8;
    return { game, score };
  }).sort((a, b) => b.score - a.score);
  const suggested = scored[0]?.score > 1 ? scored[0].game : null;
  return {
    suggested_game: suggested ? publicKnownGame(suggested) : null,
    extensions_found: extensions
  };
}

export function validateSavePath(inputPath) {
  const target = expandPath(inputPath);
  if (!target || !pathExists(target)) return { exists: false, extensions_found: [], file_count: 0 };
  const files = listFiles(target, 2);
  return {
    exists: true,
    extensions_found: [...new Set(files.map(file => path.extname(file).toLowerCase()).filter(Boolean))].sort(),
    file_count: files.length
  };
}

export function getKnownGameById(gameId) {
  const game = knownGames.find(item => item.id === gameId);
  return game ? publicKnownGame(game) : null;
}

export function toGameRecordFromKnown(gameId, sourcePath, enabled = true) {
  const game = knownGames.find(item => item.id === gameId);
  if (!game) return null;
  return {
    id: game.id,
    name: game.name,
    platform: game.platform || 'pc',
    steam_appid: game.steam_appid || null,
    source_path: expandPath(sourcePath || getSavePathForCurrentPlatform(game)),
    extensions: game.extensions || [],
    save_type: normalizeSaveType(game.save_type),
    cloud_save: Boolean(game.cloud_save),
    cloud_status: game.steam_appid ? getSteamCloudStatus(game.steam_appid, readConfig()) : 'unknown',
    enabled
  };
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) map.set(item.id, { ...map.get(item.id), ...item });
  return [...map.values()];
}

function getSavePathForCurrentPlatform(game, platform = getPlatformKey()) {
  if (platform === 'linux') {
    return game.save_paths?.linux_proton || game.save_paths?.linux || game.save_paths?.windows;
  }
  return game.save_paths?.[platform] || game.save_paths?.linux_proton || game.save_paths?.linux || game.save_paths?.windows;
}

function getExistingEmulatorPath(emulator, key, platform = getPlatformKey()) {
  for (const candidate of getEmulatorPathCandidates(emulator[key], platform)) {
    const sourcePath = expandPath(candidate);
    if (pathExists(sourcePath)) return sourcePath;
  }
  return expandPath(getEmulatorPathCandidates(emulator[key], platform)[0]);
}

function getEmulatorPathCandidates(value, platform) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    const current = value[platform] || [];
    const fallback = platform === 'linux' ? value.linux_proton || [] : [];
    return [
      ...(Array.isArray(current) ? current : [current]),
      ...(Array.isArray(fallback) ? fallback : [fallback])
    ].filter(Boolean);
  }
  return [value];
}

function normalizeSaveType(type) {
  if (type === 'files') return 'file';
  if (type === 'folders') return 'directory';
  return type || 'file';
}

function publicKnownGame(game) {
  return {
    id: game.id,
    name: game.name,
    platform: game.platform || 'pc',
    steam_appid: game.steam_appid || null,
    save_path: expandPath(getSavePathForCurrentPlatform(game)),
    extensions: game.extensions || [],
    save_type: normalizeSaveType(game.save_type),
    cloud_save: Boolean(game.cloud_save),
    icon: game.icon || null,
    search_aliases: game.search_aliases || []
  };
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function compactSearch(value) {
  return normalizeSearch(value).replace(/[^a-z0-9]/g, '');
}

function findExtensions(root) {
  return [...new Set(listFiles(root, 3).map(file => path.extname(file).toLowerCase()).filter(Boolean))].sort();
}

function listFiles(root, maxDepth = 2, depth = 0, state = { remaining: 5_000 }) {
  if (state.remaining <= 0) return [];
  const stat = safeStat(root);
  if (!stat) return [];
  if (stat.isFile()) {
    state.remaining -= 1;
    return [root];
  }
  if (!stat.isDirectory() || depth > maxDepth) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    console.warn(`Cannot read ${root}: ${error.message}`);
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (state.remaining <= 0) break;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, maxDepth, depth + 1, state));
    else if (entry.isFile()) {
      state.remaining -= 1;
      files.push(full);
    }
  }
  return files;
}
