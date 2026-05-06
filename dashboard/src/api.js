const API_STORAGE_KEY = 'savesync.apiBaseUrl';
const EMULATOR_API_BASE = 'http://10.0.2.2:3000/api';

export function getDefaultApiBaseUrl() {
  const { protocol, hostname } = window.location;
  const nativeShell = protocol === 'capacitor:' || protocol === 'http:' && hostname === 'localhost' && window.Capacitor;
  return nativeShell ? EMULATOR_API_BASE : '/api';
}

export function getApiBaseUrl() {
  return localStorage.getItem(API_STORAGE_KEY) || getDefaultApiBaseUrl();
}

export function setApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);
  if (normalized) localStorage.setItem(API_STORAGE_KEY, normalized);
  else localStorage.removeItem(API_STORAGE_KEY);
  return getApiBaseUrl();
}

export async function api(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? parseJson(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || text || `HTTP ${response.status}`);
  }
  return payload;
}

function buildApiUrl(path) {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function normalizeApiBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === getDefaultApiBaseUrl()) return '';
  const withoutSlash = trimmed.replace(/\/$/, '');
  return withoutSlash.endsWith('/api') ? withoutSlash : `${withoutSlash}/api`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
