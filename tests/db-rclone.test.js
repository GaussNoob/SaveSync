import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import db, { initDb } from '../server/db.js';
import {
  buildRcloneBisyncArgs,
  extractRcloneOAuthUrl,
  isSupportedRcloneVersion
} from '../server/rclone.js';

describe('SQLite migrations', () => {
  it('enables foreign keys and migrates save event snapshot metadata', () => {
    initDb();
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('table_info(save_events)').some(column => column.name === 'snapshot_id')).toBe(true);
  });

  it('upgrades a pre-migration database without deleting existing rows', () => {
    const legacyPath = path.join(process.env.SAVESYNC_TEST_ROOT, 'legacy.sqlite');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE games (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'pc',
        steam_appid TEXT, source_path TEXT NOT NULL, extensions TEXT DEFAULT '[]',
        save_type TEXT DEFAULT 'file', cloud_save INTEGER DEFAULT 0,
        cloud_status TEXT DEFAULT 'unknown', monitor_mode TEXT DEFAULT 'sync',
        enabled INTEGER DEFAULT 0, icon TEXT, last_save_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE save_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL,
        source_path TEXT NOT NULL, archive_path TEXT NOT NULL,
        event_type TEXT NOT NULL, size INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(game_id) REFERENCES games(id)
      );
      INSERT INTO games (id, name, source_path) VALUES ('legacy-game', 'Legacy', '/tmp/legacy');
      INSERT INTO save_events (game_id, source_path, archive_path, event_type)
        VALUES ('legacy-game', '/tmp/legacy', '/tmp/archive', 'changed');
    `);
    legacy.close();

    const dbModuleUrl = pathToFileURL(path.resolve('server/db.js')).href;
    const script = `
      const module = await import(${JSON.stringify(dbModuleUrl)});
      module.initDb();
      const db = module.default;
      console.log(JSON.stringify({
        version: db.pragma('user_version', { simple: true }),
        rows: db.prepare('SELECT COUNT(*) AS count FROM save_events').get().count,
        snapshot: db.pragma('table_info(save_events)').some(column => column.name === 'snapshot_id')
      }));
      module.closeDb();
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SAVESYNC_DB: legacyPath,
        SAVESYNC_DATA_DIR: path.dirname(legacyPath)
      }
    }).trim();
    expect(JSON.parse(output)).toEqual({ version: 3, rows: 1, snapshot: true });
  });
});

describe('rclone safety arguments', () => {
  const config = { cloud: { on_conflict: 'keep_both', max_delete_percent: 10 } };

  it('never adds force or resync implicitly', () => {
    const args = buildRcloneBisyncArgs(config, {
      localPath: process.env.SAVESYNC_DATA_DIR,
      remoteTarget: 'safe:SaveSync/'
    });
    expect(args).not.toContain('--force');
    expect(args).not.toContain('--resync');
    expect(args).toContain('--max-delete');
    expect(args).toContain('--check-access');
  });

  it('adds resync only after explicit confirmation by the caller', () => {
    const args = buildRcloneBisyncArgs(config, {
      localPath: process.env.SAVESYNC_DATA_DIR,
      remoteTarget: 'safe:SaveSync/',
      resync: true
    });
    expect(args).toContain('--resync');
    expect(isSupportedRcloneVersion('rclone v1.74.3')).toBe(true);
    expect(isSupportedRcloneVersion('rclone v1.60.1')).toBe(false);
  });

  it('only exposes loopback OAuth links emitted by rclone', () => {
    const output = [
      'If your browser does not open, visit:',
      'http://127.0.0.1:53682/auth?state=temporary-state',
      'https://malicious.example/auth?state=do-not-open'
    ].join('\n');

    expect(extractRcloneOAuthUrl(output)).toBe(
      'http://127.0.0.1:53682/auth?state=temporary-state'
    );
    expect(extractRcloneOAuthUrl('https://malicious.example/auth?state=nope')).toBeNull();
    expect(extractRcloneOAuthUrl('http://192.168.1.10:53682/auth?state=nope')).toBeNull();
  });
});
