import crypto from 'node:crypto';
import cors from 'cors';
import { readConfig } from './utils.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function getServerSecurity(config = readConfig()) {
  const host = String(process.env.SAVESYNC_HOST || config.server?.host || '127.0.0.1').trim();
  if (!host || host.length > 253 || /[\s\0/]/.test(host)) throw new Error('SAVESYNC_HOST inválido.');
  const apiToken = String(process.env.SAVESYNC_API_TOKEN || '').trim();
  const external = !isLoopbackHost(host);
  const allowedOrigins = new Set([
    ...(Array.isArray(config.server?.allowed_origins) ? config.server.allowed_origins : []),
    'capacitor://localhost',
    'http://localhost',
    'http://127.0.0.1:5173',
    'http://localhost:5173'
  ].map(origin => String(origin).replace(/\/$/, '')));

  return { host, apiToken, external, allowedOrigins };
}

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || '').toLowerCase());
}

export function assertServerSecurity(security = getServerSecurity()) {
  if (security.apiToken && security.apiToken.length < 32) {
    throw new Error('SAVESYNC_API_TOKEN deve ter pelo menos 32 caracteres.');
  }
  if (security.external && security.apiToken.length < 32) {
    throw new Error(
      'SAVESYNC_API_TOKEN com pelo menos 32 caracteres e obrigatorio quando SAVESYNC_HOST nao e loopback.'
    );
  }
}

export function createCorsMiddleware(security = getServerSecurity()) {
  return cors((req, callback) => {
    const origin = req.get('origin');
    if (!origin || isAllowedSameOrigin(req, origin, security) || security.allowedOrigins.has(origin.replace(/\/$/, ''))) {
      return callback(null, {
        origin: true,
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-SaveSync-Token']
      });
    }
      const error = new Error(`Origin nao permitida: ${origin}`);
      error.status = 403;
      return callback(error);
  });
}

function isAllowedSameOrigin(req, origin, security) {
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  if (originUrl.origin !== requestOrigin) return false;
  return security.external || isLoopbackHost(originUrl.hostname);
}

export function createApiAuthMiddleware(security = getServerSecurity()) {
  return function apiAuth(req, res, next) {
    if (req.method === 'OPTIONS' || !security.apiToken) return next();
    const authorization = String(req.get('authorization') || '');
    const supplied = authorization.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : String(req.get('x-savesync-token') || '').trim();
    if (!safeEqual(supplied, security.apiToken)) {
      res.set('WWW-Authenticate', 'Bearer realm="SaveSync"');
      return res.status(401).json({ error: 'Token da API ausente ou invalido.' });
    }
    return next();
  };
}

export function isValidApiToken(supplied, security = getServerSecurity()) {
  return !security.apiToken || safeEqual(String(supplied || ''), security.apiToken);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
