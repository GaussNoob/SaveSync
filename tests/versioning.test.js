import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getSaveEvent, initDb, listSaveEvents, upsertGame } from '../server/db.js';
import { ARCHIVE_ROOT } from '../server/utils.js';
import { archiveSave, restoreSaveEvent } from '../server/versioning.js';
import { reconcileSnapshotManifest } from '../server/archive-index.js';

const sourceRoot = path.join(process.env.SAVESYNC_TEST_ROOT, 'sources', 'game-one');
const game = {
  id: 'game-one',
  name: 'Game One',
  platform: 'custom',
  source_path: sourceRoot,
  extensions: ['.sav'],
  save_type: 'directory',
  enabled: true,
  monitor_mode: 'sync'
};

beforeAll(() => {
  initDb();
  fs.mkdirSync(path.join(sourceRoot, 'slot-a'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'slot-a', 'progress.sav'), 'level=7');
  fs.writeFileSync(path.join(sourceRoot, 'profile.dat'), 'alice');
  upsertGame(game);
});

describe('versioning', () => {
  it('archives the complete game root even when one nested file changed', () => {
    const event = archiveSave(game, path.join(sourceRoot, 'slot-a', 'progress.sav'), { versionLimit: 10 });
    expect(event.snapshot_id).toBeTruthy();
    expect(fs.readFileSync(path.join(event.archive_path, 'slot-a', 'progress.sav'), 'utf8')).toBe('level=7');
    expect(fs.readFileSync(path.join(event.archive_path, 'profile.dat'), 'utf8')).toBe('alice');

    const manifestPath = path.join(ARCHIVE_ROOT, game.id, event.snapshot_id, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.format).toBe(2);
    expect(manifest.payload_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(manifest.entry_count).toBeGreaterThan(1);
    expect(manifest.changed_path).toBe(path.join('slot-a', 'progress.sav'));
    expect(manifest.source_type).toBe('directory');
  });

  it('does not publish another snapshot when the source fingerprint is unchanged', () => {
    const first = archiveSave(game, game.source_path, { versionLimit: 10 });
    const duplicate = archiveSave(game, game.source_path, {
      versionLimit: 10,
      skipUnchanged: true
    });

    expect(first).toBeTruthy();
    expect(duplicate).toBeNull();
  });

  it('restores atomically from a DB-owned event and creates an undo snapshot', () => {
    const original = listSaveEvents(game.id).find(event => event.event_type === 'changed');
    fs.writeFileSync(path.join(sourceRoot, 'slot-a', 'progress.sav'), 'level=99');
    fs.writeFileSync(path.join(sourceRoot, 'new-file.tmp'), 'remove me');

    restoreSaveEvent(game, getSaveEvent(original.id), { versionLimit: 10 });

    expect(fs.readFileSync(path.join(sourceRoot, 'slot-a', 'progress.sav'), 'utf8')).toBe('level=7');
    expect(fs.existsSync(path.join(sourceRoot, 'new-file.tmp'))).toBe(false);
    expect(listSaveEvents(game.id).some(event => event.event_type === 'pre_restore')).toBe(true);
  });

  it('rejects an archive path outside the managed game archive', () => {
    const outside = path.join(process.env.SAVESYNC_TEST_ROOT, 'outside.sav');
    fs.writeFileSync(outside, 'malicious');
    expect(() => restoreSaveEvent(game, {
      game_id: game.id,
      source_path: game.source_path,
      archive_path: outside,
      snapshot_id: 'outside'
    })).toThrow(/fora da área gerenciada/i);
    expect(fs.readFileSync(path.join(sourceRoot, 'slot-a', 'progress.sav'), 'utf8')).toBe('level=7');
  });

  it('indexes a remote manifest once so it can be restored manually', () => {
    const existing = listSaveEvents(game.id).find(event => event.snapshot_id);
    const remoteId = '2026-01-02T03-04-05-000Z-remote01';
    const sourceDir = path.dirname(existing.archive_path);
    const remoteDir = path.join(ARCHIVE_ROOT, game.id, remoteId);
    fs.cpSync(sourceDir, remoteDir, { recursive: true });
    const manifestPath = path.join(remoteDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.snapshot_id = remoteId;
    manifest.created_at = '2026-01-02T03:04:05.000Z';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(reconcileSnapshotManifest(manifestPath)?.imported).toBe(true);
    expect(reconcileSnapshotManifest(manifestPath)?.imported).toBe(false);
    expect(listSaveEvents(game.id).some(event => event.snapshot_id === remoteId && event.event_type === 'remote')).toBe(true);
  });

  it('rejects a remote payload changed without altering its total size', () => {
    const existing = listSaveEvents(game.id).find(event => event.snapshot_id);
    const remoteId = '2026-01-02T03-04-05-000Z-tampered';
    const remoteDir = path.join(ARCHIVE_ROOT, game.id, remoteId);
    fs.cpSync(path.dirname(existing.archive_path), remoteDir, { recursive: true });
    const manifestPath = path.join(remoteDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.snapshot_id = remoteId;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const payloadFile = path.join(remoteDir, 'payload', 'profile.dat');
    fs.writeFileSync(payloadFile, 'bobby');

    expect(reconcileSnapshotManifest(manifestPath)).toBeNull();
  });

  it('refuses to restore a DB-owned snapshot whose payload was tampered with', () => {
    const event = listSaveEvents(game.id).find(row => row.snapshot_id && row.event_type === 'changed');
    const payloadFile = path.join(event.archive_path, 'profile.dat');
    const originalPayload = fs.readFileSync(payloadFile);
    const sourceBeforeRestore = fs.readFileSync(path.join(sourceRoot, 'profile.dat'));
    fs.writeFileSync(payloadFile, Buffer.from('bobby'));

    expect(() => restoreSaveEvent(game, getSaveEvent(event.id), { versionLimit: 10 }))
      .toThrow(/integridade/i);
    expect(fs.readFileSync(path.join(sourceRoot, 'profile.dat'))).toEqual(sourceBeforeRestore);

    fs.writeFileSync(payloadFile, originalPayload);
  });
});
