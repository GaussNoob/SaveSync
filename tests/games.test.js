import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { initDb, upsertGame } from '../server/db.js';
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

beforeAll(() => {
  initDb();
  fs.mkdirSync(configuredRoot, { recursive: true });
  fs.writeFileSync(path.join(configuredRoot, 'slot.sav'), 'configured');
  const portablePath = configuredRoot.replaceAll('\\', '/');
  fs.writeFileSync(process.env.SAVESYNC_CONFIG, [
    'savesync:',
    '  notify_desktop: false',
    '  scan_on_startup: false',
    'syncthing:',
    '  enabled: false',
    'cloud:',
    '  enabled: false',
    'custom_games:',
    '  - id: configured-game',
    '    name: Configured Game',
    `    saves_path: "${portablePath}"`,
    '    platform: custom',
    '    extensions: [.sav]',
    ''
  ].join('\n'));
});

afterAll(() => stopWatcher());

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
