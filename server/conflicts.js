import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import notifier from 'node-notifier';
import { ARCHIVE_ROOT, CONFLICT_ROOT, ensureDir, readConfig, safeStat, timestampId } from './utils.js';
import { getConflict, getGame, recordConflict, resolveConflict as markResolved } from './db.js';
import { assertPathWithin, isPathWithin, samePath } from './path-policy.js';
import { atomicReplacePath } from './versioning.js';

export function isSyncthingConflict(filePath) {
  const name = path.basename(String(filePath || ''));
  return /\.sync-conflict-\d{8}-\d{6}/i.test(name) ||
    /\.rclone-conflict/i.test(name) ||
    /\.conflict\d+(?=\.|$)/i.test(name);
}

export function quarantineConflict(conflictPath, game = null) {
  const stat = safeStat(conflictPath);
  if (!stat?.isFile()) return null;
  const gameId = game?.id || inferGameId(conflictPath);
  const targetDir = ensureDir(path.join(
    CONFLICT_ROOT,
    gameId || 'unknown',
    `${timestampId()}-${crypto.randomUUID().slice(0, 8)}`
  ));
  const target = path.join(targetDir, path.basename(conflictPath));
  const temporary = `${target}.tmp`;

  try {
    fs.copyFileSync(conflictPath, temporary, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporary, target);
    fs.unlinkSync(conflictPath);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(target, { force: true }); } catch { /* best effort */ }
    throw error;
  }

  const conflict = {
    game_id: gameId,
    original_path: stripConflictMarker(conflictPath),
    conflict_path: conflictPath,
    quarantine_path: target,
    metadata: {
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      kind: /sync-conflict/i.test(path.basename(conflictPath)) ? 'syncthing' : 'rclone'
    }
  };
  let result;
  try {
    result = recordConflict(conflict);
  } catch (error) {
    try {
      atomicReplacePath(target, conflictPath);
      fs.rmSync(target, { force: true });
      fs.rmdirSync(targetDir);
    } catch (recoveryError) {
      error.message = `${error.message}; a cópia segura permaneceu sem índice em ${target}: ${recoveryError.message}`;
    }
    throw error;
  }

  if (readConfig().savesync?.notify_desktop !== false) {
    notifier.notify({
      title: 'SaveSync: conflito detectado',
      message: game?.name ? `Conflito em ${game.name}` : `Conflito em ${path.basename(conflictPath)}`
    });
  }
  return { ...conflict, id: Number(result.lastInsertRowid) };
}

export function scanForConflicts(rootPaths, games = []) {
  const found = [];
  for (const root of rootPaths) {
    walk(root, filePath => {
      if (!isSyncthingConflict(filePath)) return;
      const game = games
        .filter(item => samePath(item.source_path, filePath) || isPathWithin(item.source_path, filePath))
        .sort((left, right) => right.source_path.length - left.source_path.length)[0];
      const conflict = quarantineConflict(filePath, game);
      if (conflict) found.push(conflict);
    });
  }
  return found;
}

export function resolveConflictChoice(id, resolution) {
  if (!['use-local', 'use-quarantine'].includes(resolution)) throw new Error('Resolução de conflito inválida.');
  const conflict = getConflict(id);
  if (!conflict || conflict.status !== 'open') throw new Error('Conflito aberto não encontrado.');

  if (resolution === 'use-quarantine') {
    const quarantinePath = assertPathWithin(CONFLICT_ROOT, conflict.quarantine_path);
    const originalPath = validateOriginalPath(conflict);
    const current = safeStat(originalPath);
    if (current?.isFile()) {
      const safetyCopy = path.join(path.dirname(quarantinePath), `local-before-resolution-${path.basename(originalPath)}`);
      fs.copyFileSync(originalPath, safetyCopy, fs.constants.COPYFILE_EXCL);
    }
    atomicReplacePath(quarantinePath, originalPath);
  }

  const result = markResolved(conflict.id, resolution);
  if (!result.changes) throw new Error('O conflito já foi resolvido por outra operação.');
  return { ...conflict, status: 'resolved', resolution };
}

function validateOriginalPath(conflict) {
  const original = path.resolve(conflict.original_path);
  if (safeStat(ARCHIVE_ROOT) && (samePath(ARCHIVE_ROOT, original) || isPathWithin(ARCHIVE_ROOT, original))) {
    return original;
  }
  const game = conflict.game_id ? getGame(conflict.game_id) : null;
  if (game && (samePath(game.source_path, original) || isPathWithin(game.source_path, original))) return original;
  throw new Error('O caminho original do conflito não pertence a uma fonte gerenciada.');
}

function walk(root, callback, state = { visited: 0, warned: false, maxEntries: 100_000 }) {
  state.visited += 1;
  if (state.visited > state.maxEntries) {
    if (!state.warned) {
      console.warn(`Conflict scan limit reached at ${root}; remaining entries were skipped.`);
      state.warned = true;
    }
    return;
  }
  const stat = safeStat(root);
  if (!stat) return;
  if (stat.isFile()) return callback(root);
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    console.warn(`Cannot scan ${root}: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, callback, state);
    else if (entry.isFile()) {
      state.visited += 1;
      if (state.visited > state.maxEntries) {
        if (!state.warned) {
          console.warn(`Conflict scan limit reached at ${full}; remaining entries were skipped.`);
          state.warned = true;
        }
        break;
      }
      callback(full);
    }
  }
}

function stripConflictMarker(filePath) {
  return filePath
    .replace(/\.sync-conflict-\d{8}-\d{6}-[^.\\/]+/i, '')
    .replace(/\.rclone-conflict[^.\\/]*/i, '')
    .replace(/\.conflict\d+(?=\.|$)/i, '');
}

function inferGameId(filePath) {
  if (!safeStat(ARCHIVE_ROOT) || !isPathWithin(ARCHIVE_ROOT, filePath)) return null;
  const relative = path.relative(ARCHIVE_ROOT, filePath);
  const [candidate] = relative.split(path.sep);
  return /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(candidate) ? candidate : null;
}
