import path from 'node:path';
import { ARCHIVE_ROOT, ensureArchiveControlFiles, ensureDir, readConfig } from './utils.js';
import { samePath } from './path-policy.js';

const DEFAULT_SYNCTHING_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', 'syncthing'];

export class SyncthingClient {
  constructor(config = readConfig()) {
    this.enabled = config.syncthing?.enabled !== false;
    this.apiUrl = normalizeSyncthingApiUrl(
      process.env.SYNCTHING_API_URL || config.syncthing?.api_url || 'http://localhost:8384'
    );
    const configuredKey = config.syncthing?.api_key === 'YOUR_KEY_HERE' ? '' : config.syncthing?.api_key;
    this.apiKey = process.env.SYNCTHING_API_KEY || configuredKey || '';
    this.folderId = normalizeFolderId(config.syncthing?.folder_id || 'savesync-folder');
    this.folderPath = path.resolve(ARCHIVE_ROOT);
    this.deviceIds = new Set(
      (Array.isArray(config.syncthing?.device_ids) ? config.syncthing.device_ids : [])
        .map(value => String(value).trim())
        .filter(Boolean)
    );
  }

  async request(endpoint, options = {}) {
    try {
      const {
        allowNotFound = false,
        headers: customHeaders,
        signal,
        ...fetchOptions
      } = options;
      const headers = { 'Content-Type': 'application/json', ...(customHeaders || {}) };
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;
      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        ...fetchOptions,
        headers,
        redirect: 'error',
        signal: signal || AbortSignal.timeout(15_000)
      });
      if (!response.ok) {
        if (response.status === 404 && allowNotFound) return null;
        if (response.status === 401 || response.status === 403) {
          throw new Error('Syncthing recusou a API Key. Confira a chave em Ações -> Configurações -> GUI.');
        }
        throw new Error(`Syncthing ${endpoint} falhou com HTTP ${response.status}.`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      if (error instanceof TypeError || error.name === 'TimeoutError') {
        throw new Error(`Syncthing inacessível em ${this.apiUrl}. Verifique a API GUI e a allowlist de hosts.`);
      }
      throw error;
    }
  }

  async status() { return this.request('/rest/system/status'); }
  async connections() { return this.request('/rest/system/connections'); }

  async devices() {
    return this.request('/rest/config/devices');
  }

  async folderStatus(folderId = this.folderId) {
    return this.request(`/rest/db/status?folder=${encodeURIComponent(folderId)}`);
  }

  async scan(folderId = this.folderId) {
    return this.request(`/rest/db/scan?folder=${encodeURIComponent(folderId)}`, { method: 'POST' });
  }

  async getFolder(folderId = this.folderId) {
    const normalizedFolderId = normalizeFolderId(folderId);
    return this.request(`/rest/config/folders/${encodeURIComponent(normalizedFolderId)}`, {
      allowNotFound: true
    });
  }

  async ensureFolder(folderPath = this.folderPath, folderId = this.folderId) {
    if (!samePath(folderPath, this.folderPath)) throw new Error('A pasta Syncthing deve ser o arquivo gerenciado do SaveSync.');
    ensureDir(this.folderPath);
    ensureArchiveControlFiles();
    const normalizedFolderId = normalizeFolderId(folderId);
    const [folder, devices] = await Promise.all([
      this.getFolder(normalizedFolderId),
      this.devices()
    ]);
    const allowedDevices = devices
      .filter(device => this.deviceIds.has(device.deviceID))
      .map(device => ({ deviceID: device.deviceID }));

    if (!folder) {
      const newFolder = {
        id: normalizedFolderId,
        label: 'SaveSync',
        path: this.folderPath,
        type: 'sendreceive',
        devices: allowedDevices
      };
      await this.request('/rest/config/folders', {
        method: 'POST',
        body: JSON.stringify(newFolder)
      });
      return newFolder;
    }

    if (!samePath(path.resolve(folder.path), this.folderPath)) {
      throw new Error(`O folder ID "${normalizedFolderId}" já aponta para outra pasta no Syncthing.`);
    }
    return folder;
  }

  async syncFolder(folderPath = this.folderPath, folderId = this.folderId) {
    if (!this.enabled) return { online: false, disabled: true, folder: null, scan: null };
    const folder = await this.ensureFolder(folderPath, folderId);
    const scan = await this.scan(folderId);
    return { folder, scan };
  }
}

export function normalizeSyncthingApiUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw new Error('Informe uma URL de API Syncthing válida.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('A URL Syncthing deve conter apenas protocolo, host e porta.');
  }
  const allowedHosts = new Set([
    ...DEFAULT_SYNCTHING_HOSTS,
    ...String(process.env.SAVESYNC_SYNCTHING_HOSTS || '').split(',')
  ].map(host => host.trim().toLowerCase()).filter(Boolean));
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`Host Syncthing não permitido: ${url.hostname}. Configure SAVESYNC_SYNCTHING_HOSTS para liberá-lo.`);
  }
  return url.origin;
}

export function normalizeFolderId(input) {
  const value = String(input || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) throw new Error('ID de pasta Syncthing inválido.');
  return value;
}

export default SyncthingClient;
