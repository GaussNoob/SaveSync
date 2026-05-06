import chokidar from 'chokidar';
import notifier from 'node-notifier';
import path from 'node:path';
import { listGames } from './db.js';
import { archiveSave } from './versioning.js';
import { isSyncthingConflict, quarantineConflict } from './conflicts.js';
import { readConfig } from './utils.js';
import SyncthingClient from './syncthing.js';
import { debounceCloudSync } from './cloud-sync.js';

let watcher = null;
const debounceTimers = new Map();

export function startWatcher() {
  const games = listGames({ enabledOnly: true }).filter(game => game.monitor_mode !== 'readonly');
  const paths = games.map(game => game.source_path);

  if (watcher) watcher.close();
  if (!paths.length) {
    console.log('No enabled games to watch.');
    return null;
  }

  watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 150 },
    ignored: /(^|[/\\])\../
  });

  watcher.on('all', (event, filePath) => handleChange(event, filePath, games));
  watcher.on('error', error => console.warn(`Watcher error: ${error.message}`));
  console.log(`Watching ${paths.length} save source(s).`);
  return watcher;
}

export async function stopWatcher() {
  if (watcher) await watcher.close();
  watcher = null;
}

async function handleChange(event, filePath, games) {
  const game = games.find(item => filePath.startsWith(item.source_path));
  if (!game) return;

  if (isSyncthingConflict(filePath)) {
    quarantineConflict(filePath, game);
    return;
  }

  if (!matchesExtensions(game, filePath)) return;

  clearTimeout(debounceTimers.get(filePath));
  debounceTimers.set(filePath, setTimeout(async () => {
    try {
      const freshConfig = readConfig();
      const archived = archiveSave(game, filePath, { versionLimit: freshConfig.savesync?.version_limit || 10 });
      if (freshConfig.savesync?.sync_on_change !== false && freshConfig.syncthing?.enabled !== false) {
        await new SyncthingClient(freshConfig).syncFolder().catch(error => console.warn(error.message));
      }
      if (freshConfig.savesync?.notify_desktop !== false) {
        notifier.notify({ title: 'SaveSync', message: `${game.name} sincronizado` });
      }
      debounceCloudSync();
      console.log(`Archived ${event}: ${archived.archive_path}`);
    } catch (error) {
      console.warn(`Failed to archive ${filePath}: ${error.message}`);
    }
  }, 800));
}

function matchesExtensions(game, filePath) {
  if (!game.extensions?.length || game.save_type === 'directory') return true;
  const lower = filePath.toLowerCase();
  return game.extensions.some(ext => lower.endsWith(String(ext).toLowerCase()));
}
