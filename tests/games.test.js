import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { initDb, upsertGame } from '../server/db.js';
import { stopCloudSyncSchedule } from '../server/cloud-sync.js';
import { readConfig } from '../server/utils.js';
import { stopWatcher } from '../server/watcher.js';

const app = createApp({
  security: {
    host: '127.0.0.1',
    external: false,
    apiToken: '',
    allowedOrigins: new Set()
  }
});
const sourceRoot = path.join(process.env.SAVESYNC_TEST_ROOT, 'sources', 'games-api');
const configuredRoot = path.join(sourceRoot, 'configured');
const steamRoot = path.join(sourceRoot, 'steam');
const steamapps = path.join(steamRoot, 'steamapps');
const steamUserdata = path.join(steamRoot, 'userdata');
const steamRemote = path.join(steamUserdata, '123456', '999000', 'remote');

beforeAll(() => {
  initDb();
  fs.mkdirSync(configuredRoot, { recursive: true });
  fs.mkdirSync(steamRemote, { recursive: true });
  fs.mkdirSync(path.join(steamapps, 'common', 'Generic Game'), { recursive: true });
  fs.writeFileSync(path.join(configuredRoot, 'slot.sav'), 'configured');
  fs.writeFileSync(path.join(steamRemote, 'slot.sav'), 'steam');
  fs.writeFileSync(path.join(steamapps, 'appmanifest_999000.acf'), `
"AppState" { "appid" "999000" "name" "Generic Game" "installdir" "Generic Game" }
`);
  fs.writeFileSync(path.join(steamapps, 'appmanifest_999001.acf'), `
"AppState" { "appid" "999001" "name" "Game Without Known Save" "installdir" "Unknown Save" }
`);
  fs.writeFileSync(path.join(steamapps, 'appmanifest_228980.acf'), `
"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" }
`);
  const portablePath = configuredRoot.replaceAll('\\', '/');
  const portableSteamUserdata = steamUserdata.replaceAll('\\', '/');
  fs.writeFileSync(process.env.SAVESYNC_CONFIG, [
    'savesync:',
    '  notify_desktop: false',
    '  scan_on_startup: false',
    'syncthing:',
    '  enabled: false',
    'cloud:',
    '  enabled: false',
    'steam:',
    `  userdata_path: "${portableSteamUserdata}"`,
    'custom_games:',
    '  - id: configured-game',
    '    name: Configured Game',
    `    saves_path: "${portablePath}"`,
    '    platform: custom',
    '    extensions: [.sav]',
    ''
  ].join('\n'));
});

afterAll(async () => {
  stopCloudSyncSchedule();
  await stopWatcher();
});

describe('games API', () => {
  it('preserves the platform selected for a manually registered game', async () => {
    const manualRoot = path.join(sourceRoot, 'manual');
    fs.mkdirSync(manualRoot, { recursive: true });
    const response = await request(app)
      .post('/api/games')
      .send({
        name: 'Manual GOG Game',
        platform: 'GOG',
        source_path: manualRoot,
        save_type: 'directory'
      })
      .expect(201);

    expect(response.body.platform).toBe('gog');
  });

  it('accepts a custom game returned by the server-side scanner in a bulk import', async () => {
    const response = await request(app)
      .post('/api/games/bulk')
      .send({ games: [{ game_id: 'configured-game' }] })
      .expect(201);

    expect(response.body.rejected).toEqual([]);
    expect(response.body.added).toEqual([
      expect.objectContaining({
        id: 'configured-game',
        name: 'Configured Game',
        source_path: expect.any(String)
      })
    ]);
  });

  it('shows every installed Steam game and distinguishes missing save paths', async () => {
    const response = await request(app)
      .get('/api/games/scan')
      .expect(200);

    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'steam-999000',
        name: 'Generic Game',
        steam_appid: '999000',
        save_path: steamRemote,
        can_import: true,
        requires_path: false
      }),
      expect.objectContaining({
        id: 'steam-999001',
        name: 'Game Without Known Save',
        steam_appid: '999001',
        save_path: null,
        can_import: false,
        requires_path: true,
        installed: true
      })
    ]));
    expect(response.body.some(game => game.steam_appid === '228980')).toBe(false);
  });

  it('preserves the Steam AppID when importing a discovered cloud save', async () => {
    const response = await request(app)
      .post('/api/games/bulk')
      .send({ games: [{ game_id: 'steam-999000' }] })
      .expect(201);

    expect(response.body.rejected).toEqual([]);
    expect(response.body.added).toEqual([
      expect.objectContaining({
        id: 'steam-999000',
        steam_appid: '999000',
        source_path: steamRemote
      })
    ]);
  });

  it('enables cloud sync when the connected provider settings are saved', async () => {
    await request(app)
      .post('/api/cloud/config')
      .send({
        enabled: true,
        remote_path: 'SaveSync/',
        sync_interval_minutes: 15
      })
      .expect(200);

    expect(readConfig().cloud).toEqual(expect.objectContaining({
      enabled: true,
      remote_path: 'SaveSync/',
      sync_interval_minutes: 15
    }));
  });

  it('enables several validated sources with a single watcher restart request', async () => {
    const firstRoot = path.join(sourceRoot, 'bulk-one');
    const secondRoot = path.join(sourceRoot, 'bulk-two');
    fs.mkdirSync(firstRoot, { recursive: true });
    fs.mkdirSync(secondRoot, { recursive: true });
    upsertGame({ id: 'bulk-one', name: 'Bulk One', source_path: firstRoot });
    upsertGame({ id: 'bulk-two', name: 'Bulk Two', source_path: secondRoot });

    const response = await request(app)
      .post('/api/games/enable-bulk')
      .send({
        games: [
          { id: 'bulk-one', monitor_mode: 'sync' },
          { id: 'bulk-two', monitor_mode: 'readonly' }
        ]
      })
      .expect(200);

    expect(response.body.rejected).toEqual([]);
    expect(response.body.updated).toHaveLength(2);
    expect(response.body.updated.every(game => game.enabled)).toBe(true);
  });
});
