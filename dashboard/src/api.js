const API_STORAGE_KEY = 'savesync.apiBaseUrl';
const TOKEN_STORAGE_KEY = 'savesync.apiToken';
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

export function getApiToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setApiToken(value) {
  const token = String(value || '').trim();
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
  return token;
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export async function api(path, options = {}) {
  const token = getApiToken();
  const { timeoutMs = 30_000, signal: callerSignal, ...fetchOptions } = options;
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body != null && !headers.has('Content-Type') && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  const timeoutSignal = AbortSignal.timeout(Math.max(1_000, Number(timeoutMs) || 30_000));
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  let response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...fetchOptions,
      headers,
      signal
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || timeoutSignal.aborted;
    throw new ApiError(
      timedOut ? 'A API demorou demais para responder.' : 'Não foi possível conectar à API do SaveSync.',
      0,
      { cause: error.message }
    );
  }
  const text = await response.text();
  const payload = text ? parseJson(text) : null;
  if (!response.ok) {
    throw new ApiError(payload?.error || text || `HTTP ${response.status}`, response.status, payload);
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
  const withoutSlash = trimmed.replace(/\/+$/, '');
  if (withoutSlash.startsWith('/')) {
    return withoutSlash.endsWith('/api') ? withoutSlash : `${withoutSlash}/api`;
  }

  let url;
  try {
    url = new URL(withoutSlash);
  } catch {
    throw new Error('Use uma URL completa, por exemplo http://192.168.1.10:3000/api.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('O endpoint da API deve usar HTTP ou HTTPS e não pode conter credenciais.');
  }
  url.search = '';
  url.hash = '';
  const pathname = url.pathname.replace(/\/+$/, '');
  url.pathname = pathname.endsWith('/api') ? pathname : `${pathname || ''}/api`;
  return url.toString().replace(/\/$/, '');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
