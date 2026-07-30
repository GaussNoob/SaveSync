import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = fileURLToPath(new URL('../android/', import.meta.url));
const windows = process.platform === 'win32';
const wrapper = path.join(androidDir, windows ? 'gradlew.bat' : 'gradlew');
const command = windows ? (process.env.ComSpec || 'cmd.exe') : wrapper;
const args = windows ? ['/d', '/s', '/c', `"${wrapper}" assembleDebug`] : ['assembleDebug'];
const result = spawnSync(command, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(`Não foi possível iniciar o Gradle: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
