import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;

if (process.platform !== 'win32') {
  throw new Error('O binário portátil do Windows deve ser gerado em um host Windows.');
}
if (!npmCli) {
  throw new Error('Execute este pipeline por meio de "npm run dist:win".');
}

runNpm(['run', 'check']);
runNpm([
  'exec',
  '--yes',
  '--package=@electron/rebuild@4.2.0',
  '--',
  'electron-rebuild',
  '--force',
  '--which-module',
  'better-sqlite3'
]);

let buildError;
try {
  runNpm([
    'exec',
    '--yes',
    '--package=electron-builder@26.15.3',
    '--',
    'electron-builder',
    '--win',
    'portable',
    '--x64'
  ]);
} catch (error) {
  buildError = error;
} finally {
  try {
    runNpm(['rebuild', 'better-sqlite3']);
  } catch (restoreError) {
    if (!buildError) throw restoreError;
    console.error(`Também não foi possível restaurar o better-sqlite3 para o Node.js: ${restoreError.message}`);
  }
}

if (buildError) throw buildError;

function runNpm(args) {
  run(process.execPath, [npmCli, ...args]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    },
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} encerrou com código ${result.status ?? 'desconhecido'}.`);
  }
}
