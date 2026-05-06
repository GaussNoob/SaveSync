import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { listDevices, listGames } from '../db.js';
import { filterUnavailableGames } from '../detector.js';
import SyncthingClient from '../syncthing.js';
import { CONFIG_PATH, readConfig, safeStat } from '../utils.js';
import { archiveAllEnabled, rotateAllVersions } from '../versioning.js';
import { debounceCloudSync } from '../cloud-sync.js';

const router = express.Router();

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(config), 'utf8');
}

function normalizeVersionLimit(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('O limite de backups precisa ser de pelo menos 1.');
  }
  return Math.floor(value);
}

function publicSyncthingSettings(config) {
  const syncthing = config.syncthing || {};
  return {
    enabled: syncthing.enabled !== false,
    api_url: syncthing.api_url || 'http://localhost:8384',
    api_key_set: Boolean(syncthing.api_key && syncthing.api_key !== 'YOUR_KEY_HERE'),
    folder_id: syncthing.folder_id || 'savesync-folder',
    local_path: syncthing.local_path || ''
  };
}

function normalizeSyncthingConfig(input = {}, current = {}) {
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : current.enabled !== false;
  const apiUrl = String(input.api_url || current.api_url || 'http://localhost:8384').trim().replace(/\/$/, '');
  const folderId = String(input.folder_id || current.folder_id || 'savesync-folder').trim();
  const localPath = String(input.local_path || current.local_path || '').trim();
  const apiKeyInput = input.api_key === undefined ? undefined : String(input.api_key).trim();
  const currentApiKey = current.api_key === 'YOUR_KEY_HERE' ? '' : current.api_key;

  if (!apiUrl || !/^https?:\/\//i.test(apiUrl)) {
    throw new Error('Informe uma URL de API Syncthing válida, começando com http:// ou https://.');
  }
  if (!folderId) {
    throw new Error('Informe um ID de pasta P2P.');
  }

  const next = {
    ...current,
    enabled,
    api_url: apiUrl,
    api_key: apiKeyInput ? apiKeyInput : currentApiKey,
    folder_id: folderId,
  };
  if (localPath) next.local_path = path.resolve(localPath);
  else delete next.local_path;
  return next;
}

router.get('/', async (_req, res) => {
  const config = readConfig();
  const client = new SyncthingClient(config);
  const settings = publicSyncthingSettings(config);
  const payload = {
    games: decorateGames(filterUnavailableGames(listGames(), config)),
    devices: listDevices(),
    syncthing: {
      ...settings,
      online: false,
      folder_path: client.folderPath
    },
    preferences: {
      version_limit: config.savesync?.version_limit || 10,
      sync_on_change: config.savesync?.sync_on_change !== false,
      notify_desktop: config.savesync?.notify_desktop !== false
    }
  };
  if (!settings.enabled) {
    payload.syncthing.disabled = true;
    return res.json(payload);
  }
  try {
    payload.syncthing = {
      ...settings,
      online: true,
      api_url: client.apiUrl,
      folder_id: client.folderId,
      folder_path: client.folderPath,
      status: await client.status(),
      connections: await client.connections(),
      syncthing_devices: await client.devices().catch(() => []),
      folder: await client.getFolder().catch(() => null),
      folder_status: await client.folderStatus().catch(() => null)
    };
  } catch (error) {
    payload.syncthing = {
      ...settings,
      online: false,
      api_url: client.apiUrl,
      folder_id: client.folderId,
      folder_path: client.folderPath,
      error: error.message
    };
  }
  res.json(payload);
});

router.post('/sync', async (_req, res) => {
  const local = archiveAllEnabled();
  if (local.archived.length) debounceCloudSync();
  try {
    const config = readConfig();
    if (config.syncthing?.enabled === false) {
      return res.json({ ok: true, local, syncthing: { online: false, disabled: true, error: 'P2P desativado nas configurações.' } });
    }
    const result = await new SyncthingClient(config).syncFolder();
    res.json({ ok: true, local, syncthing: result });
  } catch (error) {
    res.json({ ok: true, local, syncthing: { online: false, error: error.message } });
  }
});

router.post('/local-sync', (_req, res) => {
  const result = archiveAllEnabled();
  if (!result.archived.length) {
    return res.status(409).json({
      error: result.skipped.length
        ? 'Nenhuma fonte monitorada pôde ser arquivada.'
        : 'Nenhuma fonte monitorada. Ative o monitoramento na Biblioteca ou em Configurações.'
    });
  }
  debounceCloudSync();
  res.json({ ok: true, local: result });
});

router.post('/preferences', (req, res) => {
  try {
    const config = readConfig();
    config.savesync = {
      ...(config.savesync || {}),
      version_limit: normalizeVersionLimit(req.body?.version_limit)
    };
    writeConfig(config);
    const removed = rotateAllVersions(config.savesync.version_limit);
    res.json({
      ok: true,
      preferences: {
        version_limit: config.savesync.version_limit,
        sync_on_change: config.savesync.sync_on_change !== false,
        notify_desktop: config.savesync.notify_desktop !== false
      },
      removed_count: removed.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/syncthing', (req, res) => {
  try {
    const config = readConfig();
    config.syncthing = normalizeSyncthingConfig(req.body, config.syncthing || {});
    writeConfig(config);
    const client = new SyncthingClient(config);
    res.json({
      ok: true,
      syncthing: {
        ...publicSyncthingSettings(config),
        online: false,
        folder_path: client.folderPath
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/syncthing/test', async (req, res) => {
  try {
    const config = readConfig();
    const syncthing = normalizeSyncthingConfig(req.body || {}, config.syncthing || {});
    const client = new SyncthingClient({ ...config, syncthing });
    if (!client.enabled) {
      return res.json({ ok: true, online: false, disabled: true, message: 'P2P desativado.' });
    }
    const [status, connections, devices, folder] = await Promise.all([
      client.status(),
      client.connections(),
      client.devices().catch(() => []),
      client.getFolder().catch(() => null)
    ]);
    res.json({ ok: true, online: true, status, connections, devices, folder });
  } catch (error) {
    res.status(400).json({ ok: false, online: false, error: error.message });
  }
});

router.post('/syncthing/folder', async (_req, res) => {
  try {
    const config = readConfig();
    if (config.syncthing?.enabled === false) {
      return res.status(409).json({ error: 'P2P desativado nas configurações.' });
    }
    const client = new SyncthingClient(config);
    const result = await client.syncFolder();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;

function decorateGames(games) {
  return games.map(game => ({
    ...game,
    source_available: Boolean(safeStat(game.source_path))
  }));
}
