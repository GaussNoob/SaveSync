import { WebSocketServer } from 'ws';
import { isLoopbackHost, isValidApiToken } from './security.js';

let wss = null;

export function attachWebSocket(server, { security } = {}) {
  wss = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      return protocols.has('savesync') ? 'savesync' : false;
    }
  });
  wss.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
  });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/ws/rclone') {
      socket.destroy();
      return;
    }
    if (!isAllowedWebSocketOrigin(request, security)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!isValidApiToken(getWebSocketToken(request), security)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request));
  });
  return wss;
}

function getWebSocketToken(request) {
  const authorization = String(request.headers.authorization || '');
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
  if (request.headers['x-savesync-token']) return String(request.headers['x-savesync-token']).trim();
  const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map(value => value.trim());
  const encoded = protocols.find(value => value.startsWith('savesync-token.'))?.slice('savesync-token.'.length);
  if (!encoded) return '';
  try { return Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return ''; }
}

export function isAllowedWebSocketOrigin(request, security) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.host === request.headers.host) {
      return Boolean(security?.external) || isLoopbackHost(parsed.hostname);
    }
    return security?.allowedOrigins?.has(origin.replace(/\/$/, '')) || false;
  } catch {
    return false;
  }
}

export function broadcastRcloneLog(entry) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'rclone-log', entry });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

export function closeWebSocket() {
  if (!wss) return;
  for (const client of wss.clients) client.close(1001, 'SaveSync shutting down');
  wss.close();
  wss = null;
}
