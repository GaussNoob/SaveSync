import fs from 'node:fs';
import path from 'node:path';
import { ARCHIVE_ROOT, ensureDir, readConfig, safeStat, timestampId } from './utils.js';
import { deleteSaveEventsForArchiveRoots, listGames, recordSaveEvent } from './db.js';

/**
 * Archive saves for ALL enabled, non-readonly games.
 * Returns { archived: [...], skipped: [...] }.
 */
export function archiveAllEnabled() {
  const config = readConfig();
  const games = listGames({ enabledOnly: true }).filter(g => g.monitor_mode !== 'readonly');
  const archived = [];
  const skipped = [];

  for (const game of games) {
    if (!safeStat(game.source_path)) {
      skipped.push({ id: game.id, name: game.name, reason: 'source_unavailable' });
      continue;
    }
    try {
      archived.push(archiveSave(game, game.source_path, { versionLimit: config.savesync?.version_limit || 10 }));
    } catch (err) {
      skipped.push({ id: game.id, name: game.name, reason: err.message });
    }
  }
  return { archived, skipped };
}

export function archiveSave(game, changedPath, options = {}) {
  const limit = Number(options.versionLimit || 10);
  const source = changedPath || game.source_path;
  const stat = safeStat(source);
  if (!stat) throw new Error(`Source path unavailable: ${source}`);

  const stamp = timestampId();
  const targetDir = ensureDir(path.join(ARCHIVE_ROOT, game.id, stamp));
  const target = path.join(targetDir, path.basename(source));

  if (stat.isDirectory()) {
    copyDir(source, target);
  } else {
    fs.copyFileSync(source, target);
  }

  const event = {
    game_id: game.id,
    source_path: source,
    archive_path: target,
    event_type: 'changed',
    size: getPathSize(target)
  };
  recordSaveEvent(event);
  rotateVersions(game.id, limit);
  return event;
}

export function rotateVersions(gameId, limit = 10) {
  const gameDir = path.join(ARCHIVE_ROOT, gameId);
  if (!fs.existsSync(gameDir)) return [];
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));
  const versions = fs.readdirSync(gameDir)
    .map(name => ({ name, full: path.join(gameDir, name), stat: safeStat(path.join(gameDir, name)) }))
    .filter(item => item.stat?.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));
  const removed = [];
  for (const version of versions.slice(safeLimit)) {
    fs.rmSync(version.full, { recursive: true, force: true });
    removed.push(version.full);
  }
  deleteSaveEventsForArchiveRoots(gameId, removed);
  return removed;
}

export function rotateAllVersions(limit = 10) {
  if (!fs.existsSync(ARCHIVE_ROOT)) return [];
  return fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => rotateVersions(entry.name, limit));
}

export function restoreVersion(game, archivePath) {
  const sourceStat = safeStat(archivePath);
  if (!sourceStat) throw new Error(`Archive path unavailable: ${archivePath}`);
  ensureDir(path.dirname(game.source_path));
  if (sourceStat.isDirectory()) {
    fs.rmSync(game.source_path, { recursive: true, force: true });
    copyDir(archivePath, game.source_path);
  } else {
    const target = safeStat(game.source_path)?.isDirectory()
      ? path.join(game.source_path, path.basename(archivePath))
      : game.source_path;
    fs.copyFileSync(archivePath, target);
  }
}

function copyDir(source, target) {
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function getPathSize(target) {
  const stat = safeStat(target);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(target).reduce((sum, entry) => sum + getPathSize(path.join(target, entry)), 0);
}
