import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, upsertGame } from './db.js';
import { scanSystem } from './detector.js';
import { ARCHIVE_ROOT, CONFLICT_ROOT, ensureDir, readConfig } from './utils.js';
import { startWatcher } from './watcher.js';
import { scheduleCloudSync } from './cloud-sync.js';
import { attachWebSocket } from './websocket.js';
import gamesRouter from './routes/games.js';
import savesRouter from './routes/saves.js';
import conflictsRouter from './routes/conflicts.js';
import statusRouter from './routes/status.js';
import cloudRouter from './routes/cloud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const config = readConfig();

initDb();
ensureDir(ARCHIVE_ROOT);
ensureDir(CONFLICT_ROOT);

if (config.savesync?.scan_on_startup !== false) {
  for (const game of scanSystem(config)) upsertGame(game);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api/games', gamesRouter);
app.use('/api/saves', savesRouter);
app.use('/api/conflicts', conflictsRouter);
app.use('/api/status', statusRouter);
app.use('/api/cloud', cloudRouter);

const dashboardDist = path.resolve(__dirname, '..', 'dashboard', 'dist');
app.use(express.static(dashboardDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(dashboardDist, 'index.html'), error => {
    if (error) res.status(200).send('SaveSync API is running. Build the dashboard with npm run build.');
  });
});

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);
attachWebSocket(server);
server.listen(port, () => {
  console.log(`SaveSync dashboard/API: http://localhost:${port}`);
  startWatcher();
  scheduleCloudSync();
});
