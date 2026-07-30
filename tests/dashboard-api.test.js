import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, getApiBaseUrl, setApiBaseUrl } from '../dashboard/src/api.js';

function installBrowserGlobals() {
  const values = new Map();
  vi.stubGlobal('window', {
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:5173' }
  });
  vi.stubGlobal('localStorage', {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('dashboard API client', () => {
  it('avoids unnecessary JSON preflights for bodyless GET requests', async () => {
    installBrowserGlobals();
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/health')).resolves.toEqual({ ok: true });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('normalizes explicit remote endpoints and rejects ambiguous values', () => {
    installBrowserGlobals();
    expect(setApiBaseUrl('http://192.168.1.20:3000')).toBe('http://192.168.1.20:3000/api');
    expect(getApiBaseUrl()).toBe('http://192.168.1.20:3000/api');
    expect(() => setApiBaseUrl('192.168.1.20:3000')).toThrow(/URL completa/i);
    expect(() => setApiBaseUrl('https://user:pass@example.test')).toThrow(/credenciais/i);
  });
});
