import { WebSocketServer } from 'ws';

let wss = null;

export function attachWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws/rclone' });
  wss.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
  });
  return wss;
}

export function broadcastRcloneLog(entry) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'rclone-log', entry });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}
