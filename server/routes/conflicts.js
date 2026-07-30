import express from 'express';
import { listConflicts } from '../db.js';
import { resolveConflictChoice } from '../conflicts.js';
import { withDataLock } from '../sync-coordinator.js';

const router = express.Router();

router.get('/', (req, res) => {
  const status = ['open', 'all'].includes(req.query.status) ? req.query.status : 'open';
  res.json(listConflicts(status));
});

router.post('/:id/resolve', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'ID de conflito inválido.' });
  try {
    const conflict = await withDataLock(`conflict:${id}`, () => (
      resolveConflictChoice(id, String(req.body?.resolution || ''))
    ));
    return res.json({ ok: true, conflict });
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
});

export default router;
