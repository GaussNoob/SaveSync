import express from 'express';
import { deleteGame, getGame, listGames, setGameEnabled, upsertGame } from '../db.js';
import {
  detectKnownGame,
  filterUnavailableGames,
  getKnownGameById,
  identifySavePath,
  scanLaunchers,
  scanSystem,
  searchKnownGames,
  toGameRecordFromKnown,
  validateSavePath
} from '../detector.js';
import { disableSteamCloudForApp } from '../steam.js';
import { expandPath, normalizeGameId, pathExists, readConfig } from '../utils.js';
import { startWatcher } from '../watcher.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(filterUnavailableGames(listGames(), readConfig()));
});

router.post('/search', (req, res) => {
  res.json(searchKnownGames(req.body.query || ''));
});

router.get('/scan', (_req, res) => {
  res.json(scanLaunchers(readConfig()));
});

router.post('/detect', (req, res) => {
  const result = detectKnownGame(req.body.game_id, readConfig());
  if (!result) return res.status(404).json({ error: 'Game not found' });
  res.json(result);
});

router.post('/identify', (req, res) => {
  res.json(identifySavePath(req.body.path || ''));
});

router.post('/validate-path', (req, res) => {
  res.json(validateSavePath(req.body.path || ''));
});

router.post('/', (req, res) => {
  if (req.body.game_id && !getKnownGameById(req.body.game_id)) {
    return res.status(404).json({ error: 'Jogo conhecido não encontrado' });
  }
  const fromKnown = req.body.game_id
    ? toGameRecordFromKnown(req.body.game_id, req.body.source_path || req.body.save_path, req.body.enabled !== false)
    : null;
  const id = req.body.id || fromKnown?.id || normalizeGameId(req.body.name);
  const game = fromKnown || {
    id,
    name: req.body.name,
    platform: req.body.platform || 'custom',
    steam_appid: req.body.steam_appid || null,
    source_path: expandPath(String(req.body.source_path || req.body.save_path || '').trim()),
    extensions: normalizeExtensions(req.body.extensions),
    save_type: req.body.save_type || 'file',
    cloud_save: Boolean(req.body.cloud_save),
    cloud_status: req.body.cloud_status || 'manual',
    enabled: req.body.enabled !== false
  };
  if (!game.name || !game.source_path) {
    return res.status(400).json({ error: 'Nome e caminho do save são obrigatórios' });
  }
  if (!pathExists(game.source_path)) {
    return res.status(400).json({ error: `Caminho de save não encontrado ou sem permissão: ${game.source_path}` });
  }
  upsertGame(game);
  startWatcher();
  res.status(201).json(getGame(game.id));
});

router.post('/bulk', (req, res) => {
  const added = [];
  for (const item of req.body.games || []) {
    const game = item.game_id
      ? toGameRecordFromKnown(item.game_id, item.source_path || item.save_path, true)
      : {
          id: item.id || normalizeGameId(item.name),
          name: item.name,
          platform: item.platform || 'custom',
          source_path: expandPath(String(item.source_path || item.save_path || '').trim()),
          extensions: normalizeExtensions(item.extensions),
          save_type: item.save_type || 'file',
          enabled: true,
          cloud_save: Boolean(item.cloud_save),
          cloud_status: item.cloud_status || 'manual'
        };
    if (game?.name && game?.source_path && pathExists(game.source_path)) {
      upsertGame(game);
      added.push(getGame(game.id));
    }
  }
  startWatcher();
  res.status(201).json(added);
});

router.get('/known/:id', (req, res) => {
  const game = getKnownGameById(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

router.post('/:id/enable', (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });
  if (!pathExists(game.source_path)) {
    return res.status(400).json({ error: `Caminho de save não encontrado ou sem permissão: ${game.source_path}` });
  }
  setGameEnabled(req.params.id, true, req.body.monitor_mode || 'sync');
  startWatcher();
  res.json(getGame(req.params.id));
});

router.post('/:id/disable', (req, res) => {
  setGameEnabled(req.params.id, false);
  startWatcher();
  res.json(getGame(req.params.id));
});

router.post('/:id/steam-cloud/disable', (req, res) => {
  const game = getGame(req.params.id);
  if (!game?.steam_appid) return res.status(404).json({ error: 'Steam game not found' });
  const changed = disableSteamCloudForApp(game.steam_appid, readConfig());
  res.json({ changed });
});

router.delete('/:id', (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });
  deleteGame(req.params.id);
  startWatcher();
  res.json({ ok: true, removed: game });
});

export default router;

function normalizeExtensions(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(items
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean)
    .map(item => item.startsWith('.') ? item : `.${item}`))];
}
