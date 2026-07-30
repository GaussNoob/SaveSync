import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, ensureDir, expandPath } from './utils.js';

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

export function assertGameId(input) {
  const id = String(input || '').trim();
  if (!GAME_ID_PATTERN.test(id) || id === '.' || id === '..' || id.endsWith('.') || WINDOWS_RESERVED_NAME.test(id)) {
    throw new InputError('ID de jogo inválido.');
  }
  return id;
}

export function validateGameSourcePath(input, { mustExist = true } = {}) {
  const expanded = expandPath(String(input || '').trim());
  if (!expanded) throw new InputError('O caminho do save é obrigatório.');

  let canonical;
  try {
    canonical = fs.realpathSync.native(path.resolve(expanded));
    fs.accessSync(canonical, fs.constants.R_OK);
  } catch {
    if (!mustExist) canonical = path.resolve(expanded);
    else throw new InputError(`Caminho de save não encontrado ou sem permissão: ${expanded}`);
  }

  if (samePath(canonical, path.parse(canonical).root)) {
    throw new InputError('A raiz do sistema de arquivos não pode ser monitorada.');
  }

  const dataRoot = canonicalPath(ensureDir(DATA_ROOT));
  if (isPathWithin(dataRoot, canonical, true) || isPathWithin(canonical, dataRoot, true)) {
    throw new InputError('A fonte de saves não pode conter nem estar dentro da pasta de dados do SaveSync.');
  }
  return canonical;
}

export function assertPathWithin(root, candidate, { mustExist = true } = {}) {
  const canonicalRoot = canonicalPath(root);
  const resolvedCandidate = mustExist ? canonicalPath(candidate) : path.resolve(candidate);
  if (!isPathWithin(canonicalRoot, resolvedCandidate, true)) {
    throw new InputError('O caminho solicitado está fora da área gerenciada pelo SaveSync.');
  }
  return resolvedCandidate;
}

export function isPathWithin(root, candidate, allowEqual = false) {
  const normalizedRoot = normalizeCase(path.resolve(root));
  const normalizedCandidate = normalizeCase(path.resolve(candidate));
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  if (!relative) return allowEqual;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function samePath(left, right) {
  return normalizeCase(path.resolve(left)) === normalizeCase(path.resolve(right));
}

function canonicalPath(input) {
  try {
    return fs.realpathSync.native(path.resolve(input));
  } catch {
    throw new InputError(`Caminho indisponível: ${input}`);
  }
}

function normalizeCase(input) {
  return process.platform === 'win32' ? input.toLowerCase() : input;
}
