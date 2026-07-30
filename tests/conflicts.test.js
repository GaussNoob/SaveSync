import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getConflict, initDb, upsertGame } from '../server/db.js';
import { quarantineConflict, resolveConflictChoice } from '../server/conflicts.js';

const sourceRoot = path.join(process.env.SAVESYNC_TEST_ROOT, 'sources', 'conflict-game');
const game = {
  id: 'conflict-game',
  name: 'Conflict Game',
  platform: 'custom',
  source_path: sourceRoot,
  extensions: ['.sav'],
  save_type: 'directory',
  enabled: true
};

beforeAll(() => {
  initDb();
  fs.mkdirSync(sourceRoot, { recursive: true });
  upsertGame(game);
});

describe('conflict quarantine and resolution', () => {
  it('quarantines across filesystems and preserves local data before using the remote copy', () => {
    const original = path.join(sourceRoot, 'progress.sav');
    const conflicted = path.join(sourceRoot, 'progress.sync-conflict-20260101-010101-DEVICE.sav');
    fs.writeFileSync(original, 'local-version');
    fs.writeFileSync(conflicted, 'remote-version');

    const conflict = quarantineConflict(conflicted, game);
    expect(fs.existsSync(conflicted)).toBe(false);
    expect(fs.readFileSync(conflict.quarantine_path, 'utf8')).toBe('remote-version');

    resolveConflictChoice(conflict.id, 'use-quarantine');
    expect(fs.readFileSync(original, 'utf8')).toBe('remote-version');
    expect(getConflict(conflict.id).status).toBe('resolved');
    const safety = fs.readdirSync(path.dirname(conflict.quarantine_path))
      .find(name => name.startsWith('local-before-resolution-'));
    expect(fs.readFileSync(path.join(path.dirname(conflict.quarantine_path), safety), 'utf8')).toBe('local-version');
  });
});
