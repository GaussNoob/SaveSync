import express from 'express';
import { randomUUID } from 'node:crypto';
import { deleteGame, getGame, listGames, setGameEnabled, upsertGame } from '../db.js';
import {
  detectKnownGame,
  getKnownGameById,
  identifySavePath,
  scanLaunchers,
  searchKnownGames,
  toGameRecordFromKnown,
  validateSavePath
} from '../detector.js';
import { disableSteamCloudForApp } from '../steam.js';
import { readConfig } from '../utils.js';
import { startWatcher } from '../watcher.js';
import { assertGameId, InputError, validateGameSourcePath } from '../path-policy.js';
import { withDataLock } from '../sync-coordinator.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(listGames());
});

router.post('/search', (req, res) => {
  res.json(searchKnownGames(String(req.body.query || '').slice(0, 200)));
});

router.get('/scan', (_req, res) => {
  res.json(scanLaunchers(readConfig()));
});

router.post('/detect', (req, res) => {
  const result = detectKnownGame(req.body.game_id);
  if (!result) return res.status(404).json({ error: 'Game not found' });
  return res.json(result);
});

router.post('/identify', (req, res) => {
  res.json(identifySavePath(req.body.path || ''));
});

router.post('/validate-path', (req, res) => {
  res.json(validateSavePath(req.body.path || ''));
});

router.post('/', async (req, res) => {
  try {
    if (req.body.game_id && !getKnownGameById(req.body.game_id)) {
      return res.status(404).json({ error: 'Jogo conhecido não encontrado' });
    }
    const fromKnown = req.body.game_id
      ? toGameRecordFromKnown(req.body.game_id, req.body.source_path || req.body.save_path, req.body.enabled !== false)
      : null;
    const game = fromKnown || {
      id: `custom-${randomUUID()}`,
      name: normalizeName(req.body.name),
      platform: normalizePlatform(req.body.platform),
      steam_appid: null,
      source_path: req.body.source_path || req.body.save_path,
      extensions: normalizeExtensions(req.body.extensions),
      save_type: normalizeSaveType(req.body.save_type),
      cloud_save: false,
      cloud_status: 'manual',
      enabled: req.body.enabled !== false
    };
    game.id = assertGameId(game.id);
    game.name = normalizeName(game.name);
    game.source_path = validateGameSourcePath(game.source_path);
    await withDataLock(`game:add:${game.id}`, () => upsertGame(game));
    await startWatcher();
    return res.status(201).json(getGame(game.id));
  } catch (error) {
    const status = error instanceof InputError ? error.status : 500;
    if (status === 500) console.error(error);
    return res.status(status).json({ error: status === 500 ? 'Falha ao cadastrar o jogo.' : error.message });
  }
});

router.post('/bulk', async (req, res) => {
  const added = [];
  const rejected = [];
  const config = readConfig();
  const detectedById = new Map(scanLaunchers(config).map(item => [item.id, item]));
  const items = Array.isArray(req.body.games) ? req.body.games.slice(0, 100) : [];

  for (const item of items) {
    try {
      let game;
      const knownGame = item.game_id ? getKnownGameById(item.game_id) : null;
      if (knownGame) {
        game = toGameRecordFromKnown(item.game_id, item.source_path || item.save_path, true);
      } else {
        const detected = detectedById.get(item.id || item.game_id);
        if (!detected) throw new InputError('Entrada de scan desconhecida. Faça um novo scan.');
        game = {
          id: detected.id,
          name: detected.name,
          platform: detected.platform || 'emulator',
          source_path: detected.save_path || detected.source_path,
          extensions: detected.extensions || [],
          save_type: detected.save_type || 'file',
          enabled: true,
          cloud_save: Boolean(detected.cloud_save),
          cloud_status: detected.cloud_status || 'manual'
        };
      }
      game.id = assertGameId(game.id);
      game.name = normalizeName(game.name);
      game.source_path = validateGameSourcePath(game.source_path);
      await withDataLock(`game:add:${game.id}`, () => upsertGame(game));
      added.push(getGame(game.id));
    } catch (error) {
      rejected.push({ name: String(item.name || item.game_id || '').slice(0, 120), error: error.message });
    }
  }
  await startWatcher();
  return res.status(201).json({ added, rejected });
});

router.get('/known/:id', (req, res) => {
  const game = getKnownGameById(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  return res.json(game);
});

router.post('/enable-bulk', async (req, res) => {
  const items = Array.isArray(req.body?.games) ? req.body.games.slice(0, 100) : [];
  if (!items.length) return res.status(400).json({ error: 'Informe ao menos um jogo para ativar.' });

  const updated = [];
  const rejected = [];
  await withDataLock('games:enable-bulk', () => {
    for (const item of items) {
      try {
        const id = assertGameId(item?.id);
        const game = getGame(id);
        if (!game) throw new InputError('Jogo não encontrado.', 404);
        validateGameSourcePath(game.source_path);
        setGameEnabled(id, true, normalizeMonitorMode(item?.monitor_mode));
        updated.push(getGame(id));
      } catch (error) {
        rejected.push({
          id: String(item?.id || '').slice(0, 128),
          error: error.message
        });
      }
    }
  });
  if (updated.length) await startWatcher();
  return res.json({ updated, rejected });
});

router.post('/:id/enable', async (req, res) => {
  try {
    const id = assertGameId(req.params.id);
    const game = getGame(id);
    if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });
    validateGameSourcePath(game.source_path);
    await withDataLock(`game:enable:${id}`, () => setGameEnabled(id, true, normalizeMonitorMode(req.body.monitor_mode)));
    await startWatcher();
    return res.json(getGame(id));
  } catch (error) {
    const status = error instanceof InputError ? error.status : 500;
    if (status === 500) console.error(error);
    return res.status(status).json({ error: status === 500 ? 'Falha ao ativar o monitoramento.' : error.message });
  }
});

router.post('/:id/disable', async (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });
  await withDataLock(`game:disable:${game.id}`, () => setGameEnabled(game.id, false));
  await startWatcher();
  return res.json(getGame(req.params.id));
});

router.post('/:id/steam-cloud/disable', (req, res) => {
  const game = getGame(req.params.id);
  if (!game?.steam_appid) return res.status(404).json({ error: 'Steam game not found' });
  if (req.body.confirm !== true) return res.status(400).json({ error: 'Confirme a alteração do Steam Cloud.' });
  try {
    const changed = disableSteamCloudForApp(game.steam_appid, readConfig());
    return res.json({ changed });
  } catch (error) {
    return res.status(409).json({ error: `Steam Cloud não foi alterado: ${error.message}` });
  }
});

router.delete('/:id', async (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ error: 'Jogo não encontrado' });
  await withDataLock(`game:delete:${game.id}`, () => deleteGame(game.id));
  await startWatcher();
  return res.json({ ok: true, removed: game });
});

export default router;

function normalizeExtensions(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(items
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean)
    .map(item => item.startsWith('.') ? item : `.${item}`)
    .filter(item => /^\.[a-z0-9][a-z0-9._-]{0,31}$/i.test(item))
    .slice(0, 100))];
}

function normalizeName(input) {
  const name = String(input || '').trim();
  if (!name) throw new InputError('O nome do jogo é obrigatório.');
  if (name.length > 120) throw new InputError('O nome do jogo deve ter no máximo 120 caracteres.');
  return name;
}

function normalizeSaveType(input) {
  const value = String(input || 'file');
  if (!['file', 'files', 'directory'].includes(value)) throw new InputError('Tipo de save inválido.');
  return value;
}

function normalizePlatform(input) {
  const value = String(input || 'custom').trim().toLowerCase();
  if (!value || value.length > 40 || !/^[a-z0-9][a-z0-9 ._-]*$/i.test(value)) {
    throw new InputError('Plataforma inválida.');
  }
  return value;
}

function normalizeMonitorMode(input) {
  const value = String(input || 'sync');
  if (!['sync', 'readonly'].includes(value)) throw new InputError('Modo de monitoramento inválido.');
  return value;
}
