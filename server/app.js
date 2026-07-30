import express from 'express';
import path from 'node:path';
import { APP_ROOT } from './utils.js';
import { createApiAuthMiddleware, createCorsMiddleware, getServerSecurity } from './security.js';
import gamesRouter from './routes/games.js';
import savesRouter from './routes/saves.js';
import conflictsRouter from './routes/conflicts.js';
import statusRouter from './routes/status.js';
import cloudRouter from './routes/cloud.js';

export function createApp({ security = getServerSecurity() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      if (elapsedMs >= 2_000) {
        console.warn(`[http] slow request ${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsedMs.toFixed(0)} ms)`);
      }
    });
    next();
  });
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http: https: ws: wss:",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
    });
    next();
  });
  app.use(createCorsMiddleware(security));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => {
    if (req.body == null) req.body = {};
    next();
  });
  app.use('/api', createApiAuthMiddleware(security));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/games', gamesRouter);
  app.use('/api/saves', savesRouter);
  app.use('/api/conflicts', conflictsRouter);
  app.use('/api/status', statusRouter);
  app.use('/api/cloud', cloudRouter);
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Rota da API não encontrada: ${req.method} ${req.path}` });
  });

  const dashboardDist = path.join(APP_ROOT, 'dashboard', 'dist');
  app.use(express.static(dashboardDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(dashboardDist, 'index.html'), error => {
      if (error && !res.headersSent) {
        res.status(200).send('SaveSync API is running. Build the dashboard with npm run build.');
      }
    });
  });

  app.use((error, req, res, _next) => {
    const malformedJson = error.type === 'entity.parse.failed';
    const requestedStatus = malformedJson ? 400 : Number(error.status || error.statusCode || 500);
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;
    if (status >= 500) {
      console.error(`[http] ${req.method} ${req.originalUrl} failed:`, error);
    }
    if (!res.headersSent) {
      const message = malformedJson
        ? 'O corpo da requisição não contém JSON válido.'
        : status >= 500
          ? 'Erro interno do SaveSync.'
          : error.message;
      res.status(status).json({ error: message });
    }
  });
  return app;
}
