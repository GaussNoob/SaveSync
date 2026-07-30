import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { assertGameId, isPathWithin, validateGameSourcePath } from '../server/path-policy.js';
import { normalizeSyncthingApiUrl, SyncthingClient } from '../server/syncthing.js';
import { isAllowedWebSocketOrigin } from '../server/websocket.js';

afterEach(() => vi.unstubAllGlobals());

const token = 'a'.repeat(32);
const security = {
  host: '0.0.0.0',
  external: true,
  apiToken: token,
  allowedOrigins: new Set(['http://localhost:5173'])
};

describe('API security', () => {
  const app = createApp({ security });

  it('requires a bearer token', async () => {
    await request(app).get('/api/health').expect(401);
    const response = await request(app)
      .get('/api/health')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects origins outside the allowlist', async () => {
    await request(app)
      .options('/api/health')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });

  it('allows the production dashboard to call its same-origin API', async () => {
    await request(app)
      .options('/api/health')
      .set('Host', 'savesync.local:3000')
      .set('Origin', 'http://savesync.local:3000')
      .expect(204);
  });

  it('rejects DNS rebinding hosts while bound to loopback', async () => {
    const localApp = createApp({
      security: {
        host: '127.0.0.1',
        external: false,
        apiToken: '',
        allowedOrigins: new Set()
      }
    });
    await request(localApp)
      .options('/api/health')
      .set('Host', 'evil.example')
      .set('Origin', 'http://evil.example')
      .expect(403);
  });

  it('applies the same DNS-rebinding boundary to WebSocket upgrades', () => {
    const localSecurity = {
      host: '127.0.0.1',
      external: false,
      apiToken: '',
      allowedOrigins: new Set()
    };
    expect(isAllowedWebSocketOrigin({
      headers: { host: 'evil.example', origin: 'http://evil.example' }
    }, localSecurity)).toBe(false);
    expect(isAllowedWebSocketOrigin({
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' }
    }, localSecurity)).toBe(true);
  });

  it('returns JSON 404 responses for unknown API routes instead of the dashboard', async () => {
    const response = await request(app)
      .get('/api/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .expect('Content-Type', /json/)
      .expect(404);
    expect(response.body.error).toMatch(/rota da API/i);
  });

  it('reports malformed JSON as a client error without leaking parser details', async () => {
    const response = await request(app)
      .post('/api/games/search')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"query":')
      .expect(400);
    expect(response.body).toEqual({ error: 'O corpo da requisição não contém JSON válido.' });
  });
});

describe('path policy', () => {
  it('rejects traversal-like game IDs', () => {
    expect(() => assertGameId('../outside')).toThrow(/inválido/i);
    expect(() => assertGameId('CON')).toThrow(/inválido/i);
    expect(assertGameId('safe-game_1')).toBe('safe-game_1');
  });

  it('does not allow SaveSync data to be watched recursively', () => {
    expect(() => validateGameSourcePath(process.env.SAVESYNC_DATA_DIR)).toThrow(/pasta de dados/i);
  });

  it('compares path boundaries instead of string prefixes', () => {
    const root = process.platform === 'win32' ? 'C:\\saves\\game' : '/saves/game';
    const sibling = process.platform === 'win32' ? 'C:\\saves\\game-two' : '/saves/game-two';
    expect(isPathWithin(root, sibling)).toBe(false);
  });

  it('blocks Syncthing SSRF targets outside the explicit host allowlist', () => {
    expect(normalizeSyncthingApiUrl('http://localhost:8384')).toBe('http://localhost:8384');
    expect(() => normalizeSyncthingApiUrl('http://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => normalizeSyncthingApiUrl('http://user:pass@localhost:8384')).toThrow();
  });
});

describe('Syncthing configuration safety', () => {
  it('creates only the SaveSync folder resource instead of replacing the whole config', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url.endsWith('/rest/config/folders/savesync-folder')) {
        return new Response('', { status: 404 });
      }
      if (url.endsWith('/rest/config/devices')) {
        return Response.json([{ deviceID: 'DEVICE-A' }, { deviceID: 'DEVICE-B' }]);
      }
      if (url.endsWith('/rest/config/folders') && options.method === 'POST') {
        return Response.json({});
      }
      throw new Error(`Unexpected Syncthing request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new SyncthingClient({
      syncthing: {
        enabled: true,
        api_url: 'http://localhost:8384',
        folder_id: 'savesync-folder',
        device_ids: ['DEVICE-A']
      }
    });
    const folder = await client.ensureFolder();

    expect(folder.devices).toEqual([{ deviceID: 'DEVICE-A' }]);
    const createCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/rest/config/folders'));
    expect(createCall?.[1]?.method).toBe('POST');
    expect(JSON.parse(createCall[1].body)).toMatchObject({
      id: 'savesync-folder',
      path: client.folderPath,
      type: 'sendreceive'
    });
    expect(fetchMock.mock.calls.some(([url]) => url === 'http://localhost:8384/rest/config')).toBe(false);
  });
});
