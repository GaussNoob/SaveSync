import express from 'express';
import { getGame, getSaveEvent, listSaveEvents } from '../db.js';
import { restoreSaveEvent } from '../versioning.js';
import { withDataLock } from '../sync-coordinator.js';
import { suppressGameWatcher } from '../watcher.js';

const router = express.Router();

router.get('/:gameId', (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  return res.json(listSaveEvents(game.id));
});

router.post('/:gameId/restore', async (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const eventId = Number(req.body?.event_id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    return res.status(400).json({ error: 'event_id inválido.' });
  }
  const event = getSaveEvent(eventId);
  if (!event || event.game_id !== game.id) {
    return res.status(404).json({ error: 'Versão não encontrada para este jogo.' });
  }

  try {
    const result = await withDataLock(`restore:${game.id}`, () => {
      suppressGameWatcher(game.id, 3_000);
      return restoreSaveEvent(game, event);
    });
    suppressGameWatcher(game.id, 3_000);
    return res.json({ ok: true, ...result });
  } catch (error) {
    suppressGameWatcher(game.id, 0);
    return res.status(409).json({ error: `A restauração não foi aplicada: ${error.message}` });
  }
});

export default router;
