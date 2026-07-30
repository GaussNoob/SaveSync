import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_FORMAT = 2;
const READ_BUFFER_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;

/**
 * Read and validate the bounded metadata portion of a snapshot.
 * Payload hashing is deliberately separate so callers can skip work for
 * snapshots that are already indexed.
 */
export function readSnapshotManifest(manifestPath, {
  expectedGameId,
  expectedSnapshotId
} = {}) {
  const stat = fs.lstatSync(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('O manifesto do snapshot não é um arquivo regular.');
  }
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`O manifesto do snapshot excede ${MAX_MANIFEST_BYTES} bytes.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('O manifesto do snapshot não contém JSON válido.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('O manifesto do snapshot é inválido.');
  }
  if (![1, SNAPSHOT_FORMAT].includes(manifest.format)) {
    throw new Error(`Formato de snapshot não suportado: ${manifest.format}.`);
  }
  if (expectedGameId && manifest.game_id !== expectedGameId) {
    throw new Error('O manifesto pertence a outro jogo.');
  }
  if (expectedSnapshotId && manifest.snapshot_id !== expectedSnapshotId) {
    throw new Error('A identidade do snapshot não corresponde ao diretório.');
  }
  if (!['file', 'directory'].includes(manifest.source_type)) {
    throw new Error('O tipo da fonte no manifesto é inválido.');
  }
  return manifest;
}

/** Verify the payload type, size and content hash declared by a manifest. */
export function verifySnapshotPayload(payloadPath, manifest) {
  const stat = fs.lstatSync(payloadPath);
  if (stat.isSymbolicLink()) throw new Error('O payload do snapshot não pode ser um link simbólico.');
  if (manifest.source_type === 'file' && !stat.isFile()) {
    throw new Error('O manifesto declara um arquivo, mas o payload tem outro tipo.');
  }
  if (manifest.source_type === 'directory' && !stat.isDirectory()) {
    throw new Error('O manifesto declara um diretório, mas o payload tem outro tipo.');
  }

  const integrity = inspectSnapshotPayload(payloadPath);
  const manifestSize = Number(manifest.size);
  if (!Number.isSafeInteger(manifestSize) || manifestSize < 0 || manifestSize !== integrity.size) {
    throw new Error('O tamanho do snapshot não corresponde ao manifesto.');
  }
  if (manifest.format >= 2 && (
    manifest.entry_count !== integrity.entry_count ||
    manifest.payload_hash !== integrity.payload_hash
  )) {
    throw new Error('A verificação de integridade do snapshot falhou.');
  }
  return integrity;
}

/** Hash file contents and the complete relative-path/type tree without loading saves into memory. */
export function inspectSnapshotPayload(root, { maxEntries = 100_000 } = {}) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let size = 0;
  let entryCount = 0;

  const visit = (current, relative) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Links simbólicos não são aceitos em snapshots: ${current}`);
    entryCount += 1;
    if (entryCount > maxEntries) throw new Error(`Snapshot excede o limite de ${maxEntries} entradas.`);

    const portableRelative = relative.split(path.sep).join('/');
    if (stat.isDirectory()) {
      hash.update(`directory\0${portableRelative}\0`);
      for (const name of fs.readdirSync(current).sort()) {
        visit(path.join(current, name), path.join(relative, name));
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`Tipo de arquivo não suportado no snapshot: ${current}`);

    size += stat.size;
    hash.update(`file\0${portableRelative}\0${stat.size}\0`);
    const descriptor = fs.openSync(current, 'r');
    try {
      let bytesRead;
      do {
        bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
      } while (bytesRead);
    } finally {
      fs.closeSync(descriptor);
    }
  };

  visit(path.resolve(root), '.');
  return {
    size,
    entry_count: entryCount,
    payload_hash: `sha256:${hash.digest('hex')}`
  };
}
