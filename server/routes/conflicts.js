import express from 'express';
import { listConflicts, resolveConflict } from '../db.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.json(listConflicts(req.query.status || 'open'));
});

router.post('/:id/resolve', (req, res) => {
  resolveConflict(req.params.id, req.body.resolution || 'manual');
  res.json({ ok: true });
});

export default router;
