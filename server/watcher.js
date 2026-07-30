import chokidar from 'chokidar';
import notifier from 'node-notifier';
import path from 'node:path';
import { deleteSaveEventsForArchiveRoots, getGame, listGames } from './db.js';
import { archiveSave } from './versioning.js';
import { isSyncthingConflict, quarantineConflict, scanForConflicts } from './conflicts.js';
import { ARCHIVE_ROOT, ensureDir, readConfig, safeStat } from './utils.js';
import { isPathWithin, samePath } from './path-policy.js';
import { withDataLock } from './sync-coordinator.js';
import { reconcileArchiveIndex, reconcileSnapshotManifest } from './archive-index.js';
import SyncthingClient from './syncthing.js';
import { debounceCloudSync } from './cloud-sync.js';

let watcher = null;
let conflictWatcher = null;
let watcherGeneration = 0;
let restartQueue = Promise.resolve();
const debounceTimers = new Map();
const archiveIndexTimers = new Map();
const suppressedGames = new Map();

export function suppressGameWatcher(gameId, durationMs = 3_000) {
  clearTimeout(debounceTimers.get(gameId));
  debounceTimers.delete(gameId);
  const duration = Math.max(0, durationMs);
  if (duration) suppressedGames.set(gameId, Date.now() + duration);
  else suppressedGames.delete(gameId);
}

export function startWatcher() {
  restartQueue = restartQueue.catch(() => undefined).then(restartWatcher);
  return restartQueue;
}

export function stopWatcher() {
  restartQueue = restartQueue.catch(() => undefined).then(closeCurrentWatcher);
  return restartQueue;
}

async function restartWatcher() {
  await closeCurrentWatcher();
  const games = listGames({ enabledOnly: true }).filter(game => game.monitor_mode !== 'readonly');
  const paths = [...new Set(games.map(game => game.source_path))];
  ensureDir(ARCHIVE_ROOT);
  await withDataLock('watcher:reconcile', () => {
    scanForConflicts([ARCHIVE_ROOT, ...paths], games);
    reconcileArchiveIndex();
  });
  conflictWatcher = chokidar.watch(ARCHIVE_ROOT, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 150 }
  });
  conflictWatcher.on('add', filePath => {
    if (isSyncthingConflict(filePath)) {
      void withDataLock('quarantine:archive', () => quarantineConflict(filePath));
    } else scheduleArchiveIndex(filePath);
  });
  conflictWatcher.on('unlink', filePath => {
    if (path.basename(filePath) !== 'manifest.json') return;
    const snapshotDir = path.dirname(filePath);
    const relative = path.relative(ARCHIVE_ROOT, snapshotDir);
    const parts = relative.split(path.sep);
    if (parts.length === 2 && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      void withDataLock('archive:remove-index', () => deleteSaveEventsForArchiveRoots(parts[0], [snapshotDir]));
    }
  });
  conflictWatcher.on('error', error => console.warn(`Conflict watcher error: ${error.message}`));
  if (!paths.length) {
    console.log('No enabled games to watch.');
    return conflictWatcher;
  }

  const generation = ++watcherGeneration;
  watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 150 },
    ignored: /(^|[/\\])\../
  });
  watcher.on('all', (event, filePath) => handleChange(event, filePath, games, generation));
  watcher.on('error', error => console.warn(`Watcher error: ${error.message}`));
  console.log(`Watching ${paths.length} save source(s).`);
  return watcher;
}

async function closeCurrentWatcher() {
  watcherGeneration += 1;
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  for (const timer of archiveIndexTimers.values()) clearTimeout(timer);
  archiveIndexTimers.clear();
  suppressedGames.clear();
  const current = watcher;
  const currentConflictWatcher = conflictWatcher;
  watcher = null;
  conflictWatcher = null;
  if (current) await current.close();
  if (currentConflictWatcher) await currentConflictWatcher.close();
}

function scheduleArchiveIndex(filePath) {
  const relative = path.relative(ARCHIVE_ROOT, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  const parts = relative.split(path.sep);
  if (parts.length < 3 || parts[0].startsWith('.')) return;
  const snapshotDir = path.join(ARCHIVE_ROOT, parts[0], parts[1]);
  clearTimeout(archiveIndexTimers.get(snapshotDir));
  archiveIndexTimers.set(snapshotDir, setTimeout(() => {
    archiveIndexTimers.delete(snapshotDir);
    void withDataLock('archive:index', () => reconcileSnapshotManifest(path.join(snapshotDir, 'manifest.json')));
  }, 1_500));
}

function handleChange(event, filePath, games, generation) {
  if (generation !== watcherGeneration) return;
  const game = games
    .filter(item => samePath(item.source_path, filePath) || isPathWithin(item.source_path, filePath))
    .sort((left, right) => right.source_path.length - left.source_path.length)[0];
  if (!game) return;
  if ((suppressedGames.get(game.id) || 0) > Date.now()) return;
  suppressedGames.delete(game.id);

  if (isSyncthingConflict(filePath)) {
    void withDataLock(`quarantine:${game.id}`, () => quarantineConflict(filePath, game));
    return;
  }
  if (!matchesExtensions(game, filePath)) return;

  clearTimeout(debounceTimers.get(game.id));
  debounceTimers.set(game.id, setTimeout(() => {
    debounceTimers.delete(game.id);
    void archiveWatcherChange(game.id, event, filePath, generation);
  }, 800));
}

async function archiveWatcherChange(gameId, event, filePath, generation) {
  if (generation !== watcherGeneration) return;
  try {
    const archived = await withDataLock(`watcher:${gameId}`, () => {
      if ((suppressedGames.get(gameId) || 0) > Date.now()) return null;
      suppressedGames.delete(gameId);
      const game = getGame(gameId);
      if (!game?.enabled || game.monitor_mode === 'readonly' || !safeStat(game.source_path)) return null;
      const config = readConfig();
      const eventRecord = archiveSave(game, filePath, {
        versionLimit: config.savesync?.version_limit || 10,
        skipUnchanged: true
      });
      return eventRecord ? { eventRecord, game, config } : null;
    });
    if (!archived) return;

    const { eventRecord, game, config } = archived;
    if (config.savesync?.sync_on_change !== false) {
      if (config.syncthing?.enabled !== false) {
        await new SyncthingClient(config).syncFolder().catch(error => console.warn(error.message));
      }
      debounceCloudSync();
    }
    if (config.savesync?.notify_desktop !== false) {
      notifier.notify({ title: 'SaveSync', message: `${game.name} sincronizado` });
    }
    console.log(`Archived ${event}: ${eventRecord.archive_path}`);
  } catch (error) {
    console.warn(`Failed to archive ${filePath}: ${error.message}`);
  }
}

function matchesExtensions(game, filePath) {
  const stat = safeStat(filePath);
  if (stat?.isDirectory() || !game.extensions?.length || game.save_type === 'directory') return true;
  const lower = filePath.toLowerCase();
  return game.extensions.some(extension => lower.endsWith(String(extension).toLowerCase()));
}
