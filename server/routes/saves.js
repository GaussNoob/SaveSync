import express from 'express';
import { getGame, listSaveEvents } from '../db.js';
import { restoreVersion } from '../versioning.js';

const router = express.Router();

router.get('/:gameId', (req, res) => {
  res.json(listSaveEvents(req.params.gameId));
});

router.post('/:gameId/restore', (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  restoreVersion(game, req.body.archive_path);
  res.json({ ok: true });
});

export default router;
