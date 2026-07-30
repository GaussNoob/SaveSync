import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ARCHIVE_ROOT,
  STAGING_ROOT,
  ensureArchiveControlFiles,
  ensureDir,
  readConfig,
  safeStat,
  timestampId
} from './utils.js';
import { deleteSaveEventsForArchiveRoots, listGames, recordSaveEvent } from './db.js';
import { assertGameId, assertPathWithin, isPathWithin, samePath } from './path-policy.js';
import {
  inspectSnapshotPayload,
  readSnapshotManifest,
  SNAPSHOT_FORMAT,
  verifySnapshotPayload
} from './snapshot-integrity.js';

/** Archive every enabled, writable game as a complete snapshot. */
export function archiveAllEnabled({ skipUnchanged = false } = {}) {
  const config = readConfig();
  const games = listGames({ enabledOnly: true }).filter(game => game.monitor_mode !== 'readonly');
  const archived = [];
  const skipped = [];

  for (const game of games) {
    if (!safeStat(game.source_path)) {
      skipped.push({ id: game.id, name: game.name, reason: 'source_unavailable' });
      continue;
    }
    try {
      const event = archiveSave(game, game.source_path, {
        versionLimit: config.savesync?.version_limit || 10,
        skipUnchanged
      });
      if (event) archived.push(event);
      else skipped.push({ id: game.id, name: game.name, reason: 'unchanged' });
    } catch (error) {
      skipped.push({ id: game.id, name: game.name, reason: error.message });
    }
  }
  return { archived, skipped };
}

/**
 * Create a complete, immutable snapshot of a game's source root.
 * `changedPath` is metadata only; it never narrows the snapshot payload.
 */
export function archiveSave(game, changedPath = game.source_path, options = {}) {
  const gameId = assertGameId(game.id);
  const source = path.resolve(game.source_path);
  const sourceStat = safeStat(source);
  if (!sourceStat) throw new Error(`Source path unavailable: ${source}`);

  ensureArchiveControlFiles();
  const snapshotId = `${timestampId()}-${crypto.randomUUID().slice(0, 8)}`;
  const gameDir = ensureDir(path.join(ARCHIVE_ROOT, gameId));
  const finalDir = path.join(gameDir, snapshotId);
  const stageDir = path.join(ensureDir(STAGING_ROOT), `snapshot-${gameId}-${crypto.randomUUID()}`);
  const stagePayload = path.join(stageDir, 'payload');
  let published = false;
  let recorded = false;

  try {
    const beforeCopy = fingerprintPath(source);
    if (options.skipUnchanged && latestSourceFingerprint(gameDir) === beforeCopy) return null;
    copyPath(source, stagePayload);
    const afterCopy = fingerprintPath(source);
    if (beforeCopy !== afterCopy) {
      throw new Error('A fonte mudou durante o snapshot; a versão incompleta foi descartada.');
    }
    const integrity = inspectSnapshotPayload(stagePayload);
    const manifest = {
      format: SNAPSHOT_FORMAT,
      snapshot_id: snapshotId,
      game_id: gameId,
      created_at: new Date().toISOString(),
      source_path: source,
      source_type: sourceStat.isDirectory() ? 'directory' : 'file',
      changed_path: normalizeChangedPath(source, changedPath),
      source_fingerprint: beforeCopy,
      ...integrity
    };
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.renameSync(stageDir, finalDir);
    published = true;

    const event = {
      game_id: gameId,
      source_path: source,
      archive_path: path.join(finalDir, 'payload'),
      snapshot_id: snapshotId,
      event_type: options.eventType || 'changed',
      size: manifest.size
    };
    recordSaveEvent(event);
    recorded = true;
    if (options.rotate !== false) rotateVersions(gameId, options.versionLimit || 10);
    return event;
  } catch (error) {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch { /* best effort */ }
    if (published && !recorded) {
      try { fs.rmSync(finalDir, { recursive: true, force: true }); } catch { /* reconciled on next startup */ }
    }
    throw error;
  }
}

export function rotateVersions(gameId, limit = 10) {
  const safeGameId = assertGameId(gameId);
  const gameDir = path.join(ARCHIVE_ROOT, safeGameId);
  if (!fs.existsSync(gameDir)) return [];
  const safeLimit = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 10)));
  const versions = fs.readdirSync(gameDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, full: path.join(gameDir, entry.name) }))
    .sort((left, right) => right.name.localeCompare(left.name));
  const removed = [];
  for (const version of versions.slice(safeLimit)) {
    assertPathWithin(gameDir, version.full);
    fs.rmSync(version.full, { recursive: true, force: true });
    removed.push(version.full);
  }
  deleteSaveEventsForArchiveRoots(safeGameId, removed);
  return removed;
}

export function rotateAllVersions(limit = 10) {
  if (!fs.existsSync(ARCHIVE_ROOT)) return [];
  return fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(entry.name))
    .flatMap(entry => rotateVersions(entry.name, limit));
}

/** Restore a DB-owned event, never a client-provided filesystem path. */
export function restoreSaveEvent(game, event, options = {}) {
  if (!event || event.game_id !== game.id) throw new Error('A versão não pertence a este jogo.');
  const gameArchiveRoot = path.join(ARCHIVE_ROOT, assertGameId(game.id));
  const archivePath = assertPathWithin(gameArchiveRoot, event.archive_path);
  const archiveStat = safeStat(archivePath);
  if (!archiveStat) throw new Error(`Archive path unavailable: ${archivePath}`);
  if (event.snapshot_id) verifyEventSnapshot(game, event, archivePath);

  const target = resolveRestoreTarget(game, event);
  const targetStat = safeStat(target);
  if (targetStat && targetStat.isDirectory() !== archiveStat.isDirectory()) {
    throw new Error('O tipo do snapshot não corresponde ao destino atual (arquivo/diretório).');
  }
  if (safeStat(game.source_path)) {
    archiveSave(game, game.source_path, {
      eventType: 'pre_restore',
      rotate: false,
      versionLimit: options.versionLimit
    });
  }

  atomicReplacePath(archivePath, target);
  rotateVersions(game.id, options.versionLimit || readConfig().savesync?.version_limit || 10);
  return { restored_path: target };
}

function resolveRestoreTarget(game, event) {
  if (event.snapshot_id) return path.resolve(game.source_path);
  const legacySource = path.resolve(event.source_path || game.source_path);
  const gameRoot = path.resolve(game.source_path);
  if (!samePath(legacySource, gameRoot) && !isPathWithin(gameRoot, legacySource)) {
    throw new Error('O evento legado aponta para fora da fonte atual do jogo.');
  }
  return legacySource;
}

export function atomicReplacePath(source, target) {
  const parent = ensureDir(path.dirname(target));
  const suffix = crypto.randomUUID();
  const stage = path.join(parent, `.${path.basename(target)}.savesync-stage-${suffix}`);
  const backup = path.join(parent, `.${path.basename(target)}.savesync-backup-${suffix}`);
  let oldMoved = false;
  let newInstalled = false;

  try {
    copyPath(source, stage);
    if (safeStat(target)) {
      fs.renameSync(target, backup);
      oldMoved = true;
    }
    fs.renameSync(stage, target);
    newInstalled = true;
    if (oldMoved) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    try {
      if (newInstalled && safeStat(target)) fs.rmSync(target, { recursive: true, force: true });
      if (oldMoved && safeStat(backup)) fs.renameSync(backup, target);
    } catch (rollbackError) {
      error.message = `${error.message}; rollback também falhou: ${rollbackError.message}`;
    }
    throw error;
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function copyPath(source, target, state = { entries: 0, maxEntries: 100_000 }) {
  state.entries += 1;
  if (state.entries > state.maxEntries) {
    throw new Error(`Snapshot excede o limite de ${state.maxEntries} entradas.`);
  }
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos em snapshots: ${source}`);
  if (stat.isFile()) {
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
    return;
  }
  if (!stat.isDirectory()) throw new Error(`Tipo de arquivo não suportado no snapshot: ${source}`);
  ensureDir(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    copyPath(path.join(source, entry.name), path.join(target, entry.name), state);
  }
}

function normalizeChangedPath(sourceRoot, changedPath) {
  const resolved = path.resolve(changedPath || sourceRoot);
  if (samePath(sourceRoot, resolved)) return '.';
  return isPathWithin(sourceRoot, resolved) ? path.relative(sourceRoot, resolved) : null;
}

function verifyEventSnapshot(game, event, archivePath) {
  const snapshotId = assertGameId(event.snapshot_id);
  const snapshotDir = path.join(ARCHIVE_ROOT, assertGameId(game.id), snapshotId);
  const expectedPayload = assertPathWithin(snapshotDir, path.join(snapshotDir, 'payload'));
  if (!samePath(archivePath, expectedPayload)) {
    throw new Error('O evento aponta para um payload diferente do snapshot registrado.');
  }
  const manifestPath = assertPathWithin(snapshotDir, path.join(snapshotDir, 'manifest.json'));
  const manifest = readSnapshotManifest(manifestPath, {
    expectedGameId: game.id,
    expectedSnapshotId: snapshotId
  });
  verifySnapshotPayload(archivePath, manifest);
}

function latestSourceFingerprint(gameDir) {
  let entries;
  try {
    entries = fs.readdirSync(gameDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((left, right) => right.name.localeCompare(left.name));
  } catch {
    return null;
  }

  for (const entry of entries) {
    try {
      const manifest = readSnapshotManifest(path.join(gameDir, entry.name, 'manifest.json'), {
        expectedGameId: path.basename(gameDir),
        expectedSnapshotId: entry.name
      });
      return typeof manifest.source_fingerprint === 'string' ? manifest.source_fingerprint : null;
    } catch {
      // A malformed newest directory should not prevent creating a valid snapshot.
    }
  }
  return null;
}

function fingerprintPath(root) {
  const hash = crypto.createHash('sha256');
  let entryCount = 0;
  const visit = (current, relative) => {
    entryCount += 1;
    if (entryCount > 100_000) throw new Error('A fonte excede o limite de 100000 entradas por snapshot.');
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos em snapshots: ${current}`);
    hash.update(`${relative}\0${stat.isDirectory() ? 'd' : 'f'}\0${stat.size}\0${stat.mtimeMs}\n`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name), path.join(relative, name));
    }
  };
  visit(root, '.');
  return hash.digest('hex');
}
