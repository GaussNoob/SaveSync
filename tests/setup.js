import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'savesync-test-'));
const dataRoot = path.join(testRoot, 'data');
fs.mkdirSync(dataRoot, { recursive: true });

process.env.SAVESYNC_TEST_ROOT = testRoot;
process.env.SAVESYNC_DATA_DIR = dataRoot;
process.env.SAVESYNC_DB = path.join(dataRoot, 'test.sqlite');
process.env.SAVESYNC_CONFIG = path.join(testRoot, 'config.yaml');
process.env.SAVESYNC_HOST = '127.0.0.1';
delete process.env.SAVESYNC_API_TOKEN;
fs.writeFileSync(process.env.SAVESYNC_CONFIG, [
  'savesync:',
  '  notify_desktop: false',
  '  scan_on_startup: false',
  'syncthing:',
  '  enabled: false',
  'cloud:',
  '  enabled: false',
  ''
].join('\n'));

afterAll(async () => {
  try {
    const { closeDb } = await import('../server/db.js');
    closeDb();
  } catch { /* a unit-only test may never load the DB */ }
  fs.rmSync(testRoot, { recursive: true, force: true });
});
