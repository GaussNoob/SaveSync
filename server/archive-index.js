import fs from 'node:fs';
import path from 'node:path';
import { getGame, getSaveEventBySnapshot, recordSaveEventIfMissing } from './db.js';
import { ARCHIVE_ROOT, safeStat } from './utils.js';
import { assertGameId, assertPathWithin } from './path-policy.js';
import { readSnapshotManifest, verifySnapshotPayload } from './snapshot-integrity.js';

export function reconcileArchiveIndex() {
  const imported = [];
  if (!safeStat(ARCHIVE_ROOT)?.isDirectory()) return imported;
  for (const gameEntry of fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })) {
    if (!gameEntry.isDirectory() || gameEntry.name.startsWith('.')) continue;
    const gameDir = path.join(ARCHIVE_ROOT, gameEntry.name);
    for (const snapshotEntry of safeReadDir(gameDir)) {
      if (!snapshotEntry.isDirectory()) continue;
      const result = reconcileSnapshotManifest(path.join(gameDir, snapshotEntry.name, 'manifest.json'));
      if (result?.imported) imported.push(result.event);
    }
  }
  return imported;
}

export function reconcileSnapshotManifest(manifestPath) {
  try {
    return reconcileSnapshotManifestUnsafe(manifestPath);
  } catch {
    return null;
  }
}

function reconcileSnapshotManifestUnsafe(manifestPath) {
  const snapshotDir = path.dirname(manifestPath);
  const gameDir = path.dirname(snapshotDir);
  const gameId = assertGameId(path.basename(gameDir));
  const snapshotId = assertGameId(path.basename(snapshotDir));
  assertPathWithin(path.join(ARCHIVE_ROOT, gameId), manifestPath);

  const manifest = readSnapshotManifest(manifestPath, {
    expectedGameId: gameId,
    expectedSnapshotId: snapshotId
  });
  const game = getGame(gameId);
  if (!game) return null;

  const payloadPath = assertPathWithin(snapshotDir, path.join(snapshotDir, 'payload'));
  const existing = getSaveEventBySnapshot(gameId, snapshotId);
  if (existing) return { imported: false, event: existing };

  const integrity = verifySnapshotPayload(payloadPath, manifest);
  const event = {
    game_id: gameId,
    source_path: game.source_path,
    archive_path: payloadPath,
    snapshot_id: snapshotId,
    event_type: 'remote',
    size: integrity.size,
    created_at: normalizeTimestamp(manifest.created_at)
  };
  const result = recordSaveEventIfMissing(event);
  return { imported: Boolean(result.changes), event };
}

function safeReadDir(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}
