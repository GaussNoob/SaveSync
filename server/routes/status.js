import express from 'express';
import { listDevices, listGames } from '../db.js';
import SyncthingClient, { normalizeFolderId, normalizeSyncthingApiUrl } from '../syncthing.js';
import { ARCHIVE_ROOT, readConfig, safeStat, writeConfig } from '../utils.js';
import { archiveAllEnabled, rotateAllVersions } from '../versioning.js';
import { debounceCloudSync } from '../cloud-sync.js';
import { getDataLockStatus, withDataLock } from '../sync-coordinator.js';

const router = express.Router();

function normalizeVersionLimit(input) {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 1 || value > 1000) {
    throw new Error('O limite de backups deve ficar entre 1 e 1000.');
  }
  return Math.floor(value);
}

function publicSyncthingSettings(config) {
  const syncthing = config.syncthing || {};
  return {
    enabled: syncthing.enabled !== false,
    api_url: process.env.SYNCTHING_API_URL || syncthing.api_url || 'http://localhost:8384',
    api_key_set: Boolean(process.env.SYNCTHING_API_KEY || (syncthing.api_key && syncthing.api_key !== 'YOUR_KEY_HERE')),
    folder_id: syncthing.folder_id || 'savesync-folder',
    local_path: ARCHIVE_ROOT
  };
}

function normalizeSyncthingConfig(input = {}, current = {}) {
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : current.enabled !== false;
  const apiUrl = normalizeSyncthingApiUrl(input.api_url || current.api_url || 'http://localhost:8384');
  const folderId = normalizeFolderId(input.folder_id || current.folder_id || 'savesync-folder');
  const apiKeyInput = input.api_key === undefined ? undefined : String(input.api_key).trim();
  const currentApiKey = current.api_key === 'YOUR_KEY_HERE' ? '' : current.api_key;

  const next = {
    ...current,
    enabled,
    api_url: apiUrl,
    api_key: apiKeyInput ? apiKeyInput : currentApiKey,
    folder_id: folderId,
    local_path: ARCHIVE_ROOT
  };
  return next;
}

router.get('/', async (_req, res) => {
  const config = readConfig();
  const client = new SyncthingClient(config);
  const settings = publicSyncthingSettings(config);
  const payload = {
    games: decorateGames(listGames()),
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
    },
    operations: getDataLockStatus()
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
  try {
    const local = await withDataLock('api:sync', () => archiveAllEnabled());
    const config = readConfig();
    let syncthing;
    if (config.syncthing?.enabled === false) {
      syncthing = { online: false, disabled: true, error: 'P2P desativado nas configurações.' };
    } else {
      try {
        syncthing = await new SyncthingClient(config).syncFolder();
      } catch (error) {
        syncthing = { online: false, error: error.message };
      }
    }
    if (local.archived.length) debounceCloudSync();
    const payload = { ok: true, local, syncthing };
    res.json(payload);
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

router.post('/local-sync', async (_req, res) => {
  const result = await withDataLock('api:local-sync', () => archiveAllEnabled());
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

router.post('/preferences', async (req, res) => {
  try {
    const config = readConfig();
    config.savesync = {
      ...(config.savesync || {}),
      version_limit: normalizeVersionLimit(req.body?.version_limit)
    };
    writeConfig(config);
    const removed = await withDataLock('preferences:rotate', () => rotateAllVersions(config.savesync.version_limit));
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
