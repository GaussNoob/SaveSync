import Database from 'better-sqlite3';
import path from 'node:path';
import { DATA_ROOT, ensureDir } from './utils.js';

const dbPath = process.env.SAVESYNC_DB || path.join(ensureDir(DATA_ROOT), 'savesync.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'pc',
      steam_appid TEXT,
      source_path TEXT NOT NULL,
      extensions TEXT DEFAULT '[]',
      save_type TEXT DEFAULT 'file',
      cloud_save INTEGER DEFAULT 0,
      cloud_status TEXT DEFAULT 'unknown',
      monitor_mode TEXT DEFAULT 'sync',
      enabled INTEGER DEFAULT 0,
      icon TEXT,
      last_save_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS save_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      archive_path TEXT NOT NULL,
      event_type TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(game_id) REFERENCES games(id)
    );

    CREATE TABLE IF NOT EXISTS conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT,
      original_path TEXT NOT NULL,
      conflict_path TEXT NOT NULL,
      quarantine_path TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      status TEXT DEFAULT 'open',
      resolution TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT,
      address TEXT,
      connected INTEGER DEFAULT 0,
      last_seen_at TEXT,
      metadata TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS cloud_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT DEFAULT 'info',
      message TEXT NOT NULL,
      files_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function upsertGame(game) {
  const stmt = db.prepare(`
    INSERT INTO games (
      id, name, platform, steam_appid, source_path, extensions, save_type,
      cloud_save, cloud_status, monitor_mode, enabled, icon, last_save_at, updated_at
    )
    VALUES (
      @id, @name, @platform, @steam_appid, @source_path, @extensions, @save_type,
      @cloud_save, @cloud_status, @monitor_mode, @enabled, @icon, @last_save_at, CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      platform=excluded.platform,
      steam_appid=excluded.steam_appid,
      source_path=excluded.source_path,
      extensions=excluded.extensions,
      save_type=excluded.save_type,
      cloud_save=excluded.cloud_save,
      cloud_status=excluded.cloud_status,
      monitor_mode=excluded.monitor_mode,
      enabled=excluded.enabled,
      icon=excluded.icon,
      last_save_at=COALESCE(excluded.last_save_at, games.last_save_at),
      updated_at=CURRENT_TIMESTAMP
  `);
  return stmt.run({
    id: game.id,
    name: game.name,
    platform: game.platform || 'pc',
    steam_appid: game.steam_appid || null,
    source_path: game.source_path,
    extensions: JSON.stringify(game.extensions || []),
    save_type: game.save_type || 'file',
    cloud_save: game.cloud_save ? 1 : 0,
    cloud_status: game.cloud_status || 'unknown',
    monitor_mode: game.monitor_mode || 'sync',
    enabled: game.enabled ? 1 : 0,
    icon: game.icon || null,
    last_save_at: game.last_save_at || null
  });
}

export function listGames({ enabledOnly = false } = {}) {
  const rows = enabledOnly
    ? db.prepare('SELECT * FROM games WHERE enabled = 1 ORDER BY platform, name').all()
    : db.prepare('SELECT * FROM games ORDER BY platform, name').all();
  return rows.map(hydrateGame);
}

export function getGame(id) {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  return row ? hydrateGame(row) : null;
}

export function deleteGame(id) {
  const tx = db.transaction(gameId => {
    db.prepare('DELETE FROM save_events WHERE game_id = ?').run(gameId);
    db.prepare('DELETE FROM conflicts WHERE game_id = ?').run(gameId);
    return db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
  });
  return tx(id);
}

export function setGameEnabled(id, enabled, monitorMode = 'sync') {
  return db.prepare('UPDATE games SET enabled = ?, monitor_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(enabled ? 1 : 0, monitorMode, id);
}

export function recordSaveEvent(event) {
  db.prepare(`
    INSERT INTO save_events (game_id, source_path, archive_path, event_type, size)
    VALUES (@game_id, @source_path, @archive_path, @event_type, @size)
  `).run(event);
  db.prepare('UPDATE games SET last_save_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(event.game_id);
}

export function listSaveEvents(gameId) {
  return db.prepare('SELECT * FROM save_events WHERE game_id = ? ORDER BY created_at DESC').all(gameId);
}

export function deleteSaveEventsForArchiveRoots(gameId, archiveRoots = []) {
  const roots = archiveRoots.map(root => String(root)).filter(Boolean);
  if (!roots.length) return { changes: 0 };

  const stmt = db.prepare(`
    DELETE FROM save_events
    WHERE game_id = ?
      AND (
        archive_path = ?
        OR substr(archive_path, 1, ?) = ?
        OR substr(archive_path, 1, ?) = ?
      )
  `);
  const tx = db.transaction((id, targets) => {
    let changes = 0;
    for (const root of targets) {
      const slashPrefix = `${root}/`;
      const backslashPrefix = `${root}\\`;
      changes += stmt.run(
        id,
        root,
        slashPrefix.length,
        slashPrefix,
        backslashPrefix.length,
        backslashPrefix
      ).changes;
    }
    return { changes };
  });
  return tx(gameId, roots);
}

export function recordConflict(conflict) {
  return db.prepare(`
    INSERT INTO conflicts (game_id, original_path, conflict_path, quarantine_path, metadata)
    VALUES (@game_id, @original_path, @conflict_path, @quarantine_path, @metadata)
  `).run({
    ...conflict,
    metadata: JSON.stringify(conflict.metadata || {})
  });
}

export function listConflicts(status = 'open') {
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM conflicts ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM conflicts WHERE status = ? ORDER BY created_at DESC').all(status);
  return rows.map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }));
}

export function resolveConflict(id, resolution) {
  return db.prepare(`
    UPDATE conflicts SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(resolution, id);
}

export function upsertDevice(device) {
  return db.prepare(`
    INSERT INTO devices (id, name, address, connected, last_seen_at, metadata)
    VALUES (@id, @name, @address, @connected, CURRENT_TIMESTAMP, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      address=excluded.address,
      connected=excluded.connected,
      last_seen_at=CURRENT_TIMESTAMP,
      metadata=excluded.metadata
  `).run({
    ...device,
    connected: device.connected ? 1 : 0,
    metadata: JSON.stringify(device.metadata || {})
  });
}

export function listDevices() {
  return db.prepare('SELECT * FROM devices ORDER BY name').all()
    .map(row => ({ ...row, connected: Boolean(row.connected), metadata: JSON.parse(row.metadata || '{}') }));
}

export function recordCloudLog(message, level = 'info', filesSynced = 0) {
  return db.prepare(`
    INSERT INTO cloud_sync_log (level, message, files_synced) VALUES (?, ?, ?)
  `).run(level, String(message).slice(0, 4000), filesSynced);
}

export function listCloudLog(limit = 100) {
  return db.prepare('SELECT * FROM cloud_sync_log ORDER BY id DESC LIMIT ?').all(Number(limit))
    .reverse();
}

export function getCloudStatusFromDb() {
  const last = db.prepare("SELECT * FROM cloud_sync_log WHERE message = 'Rclone bisync completed' ORDER BY id DESC LIMIT 1").get();
  const lastError = last
    ? db.prepare("SELECT * FROM cloud_sync_log WHERE level = 'error' AND id > ? ORDER BY id DESC LIMIT 1").get(last.id)
    : db.prepare("SELECT * FROM cloud_sync_log WHERE level = 'error' ORDER BY id DESC LIMIT 1").get();
  const files = db.prepare('SELECT COALESCE(SUM(files_synced), 0) AS total FROM cloud_sync_log').get();
  return {
    last_sync: last?.created_at || null,
    files_synced: files?.total || 0,
    error: lastError?.message || null
  };
}

function hydrateGame(row) {
  return {
    ...row,
    extensions: JSON.parse(row.extensions || '[]'),
    cloud_save: Boolean(row.cloud_save),
    enabled: Boolean(row.enabled)
  };
}

export default db;
