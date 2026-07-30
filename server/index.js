import http from 'node:http';
import { createApp } from './app.js';
import { closeDb, initDb, listGames, setGameEnabled, upsertDetectedGame } from './db.js';
import { scanSystem } from './detector.js';
import { ARCHIVE_ROOT, CONFLICT_ROOT, ensureDir, readConfig } from './utils.js';
import { startWatcher, stopWatcher } from './watcher.js';
import { scheduleCloudSync, stopCloudSyncSchedule } from './cloud-sync.js';
import { attachWebSocket, closeWebSocket } from './websocket.js';
import { assertServerSecurity, getServerSecurity } from './security.js';
import { terminateRcloneProcesses } from './rclone.js';
import { assertGameId, validateGameSourcePath } from './path-policy.js';
import { waitForDataIdle } from './sync-coordinator.js';

const config = readConfig();
const security = getServerSecurity(config);
assertServerSecurity(security);

initDb();
ensureDir(ARCHIVE_ROOT);
ensureDir(CONFLICT_ROOT);

for (const game of listGames({ enabledOnly: true })) {
  try {
    assertGameId(game.id);
    validateGameSourcePath(game.source_path, { mustExist: false });
  } catch (error) {
    setGameEnabled(game.id, false, game.monitor_mode);
    console.warn(`Fonte insegura desativada (${game.name}): ${error.message}`);
  }
}

if (config.savesync?.scan_on_startup !== false) {
  for (const game of scanSystem(config)) {
    try {
      game.id = assertGameId(game.id);
      game.source_path = validateGameSourcePath(game.source_path, { mustExist: false });
      upsertDetectedGame(game);
    } catch (error) {
      console.warn(`Fonte detectada ignorada (${game.name || game.id}): ${error.message}`);
    }
  }
}

const app = createApp({ security });
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT deve estar entre 0 e 65535.');
const server = http.createServer(app);
let shuttingDown = false;
attachWebSocket(server, { security });
server.listen(port, security.host, () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`SaveSync dashboard/API: http://${security.host}:${activePort}`);
  process.parentPort?.postMessage({
    type: 'savesync:ready',
    host: security.host,
    port: activePort
  });
  void startWatcher()
    .catch(error => console.error(`Falha ao iniciar o watcher: ${error.message}`))
    .finally(scheduleCloudSync);
});
server.once('error', error => {
  console.error(`Falha no servidor HTTP: ${error.message}`);
  closeWebSocket();
  closeDb();
  process.exitCode = 1;
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Recebido ${signal}; encerrando SaveSync.`);
  const forcedExit = setTimeout(() => process.exit(1), 10_000);
  forcedExit.unref();
  const serverClosed = new Promise(resolve => server.close(resolve));
  stopCloudSyncSchedule();
  terminateRcloneProcesses();
  closeWebSocket();
  await stopWatcher();
  await waitForDataIdle();
  await serverClosed;
  closeDb();
  clearTimeout(forcedExit);
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
