import fs from 'node:fs';
import path from 'node:path';
import notifier from 'node-notifier';
import { CONFLICT_ROOT, ensureDir, readConfig, safeStat, timestampId } from './utils.js';
import { getGame, recordConflict, resolveConflict as markResolved } from './db.js';
import { restoreVersion } from './versioning.js';

export function isSyncthingConflict(filePath) {
  return /\.sync-conflict-\d{8}-\d{6}/.test(filePath) || filePath.includes('.sync-conflict-');
}

export function quarantineConflict(conflictPath, game = null) {
  const stat = safeStat(conflictPath);
  if (!stat) return null;
  const gameId = game?.id || inferGameId(conflictPath);
  const targetDir = ensureDir(path.join(CONFLICT_ROOT, gameId || 'unknown', timestampId()));
  const target = path.join(targetDir, path.basename(conflictPath));
  fs.renameSync(conflictPath, target);

  const conflict = {
    game_id: gameId,
    original_path: stripConflictMarker(conflictPath),
    conflict_path: conflictPath,
    quarantine_path: target,
    metadata: {
      size: stat.size,
      mtime: stat.mtime.toISOString()
    }
  };
  recordConflict(conflict);

  if (readConfig().savesync?.notify_desktop !== false) {
    notifier.notify({
      title: 'SaveSync: conflito detectado',
      message: game?.name ? `Conflito em ${game.name}` : `Conflito em ${path.basename(conflictPath)}`
    });
  }
  return conflict;
}

export function scanForConflicts(rootPaths, games = []) {
  const found = [];
  for (const root of rootPaths) walk(root, filePath => {
    if (!isSyncthingConflict(filePath)) return;
    const game = games.find(item => filePath.startsWith(item.source_path));
    const conflict = quarantineConflict(filePath, game);
    if (conflict) found.push(conflict);
  });
  return found;
}

export function resolveConflict(id, choicePath) {
  const gameId = choicePath?.game_id;
  if (gameId) {
    const game = getGame(gameId);
    if (game) restoreVersion(game, choicePath.quarantine_path);
  }
  markResolved(id, choicePath?.quarantine_path || 'manual');
}

function walk(root, callback) {
  if (!safeStat(root)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    console.warn(`Cannot scan ${root}: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, callback);
    else if (entry.isFile()) callback(full);
  }
}

function stripConflictMarker(filePath) {
  return filePath.replace(/\.sync-conflict-\d{8}-\d{6}-[^.]+/, '');
}

function inferGameId(filePath) {
  const parts = filePath.split(path.sep);
  const index = parts.indexOf('games');
  return index >= 0 ? parts[index + 1] : null;
}
