import path from 'node:path';
import { ARCHIVE_ROOT, ensureDir, readConfig } from './utils.js';

export class SyncthingClient {
  constructor(config = readConfig()) {
    this.enabled = config.syncthing?.enabled !== false;
    this.apiUrl = config.syncthing?.api_url || 'http://localhost:8384';
    const configuredKey = config.syncthing?.api_key === 'YOUR_KEY_HERE' ? '' : config.syncthing?.api_key;
    this.apiKey = configuredKey || process.env.SYNCTHING_API_KEY || '';
    this.folderId = config.syncthing?.folder_id || 'savesync-folder';
    this.folderPath = path.resolve(config.syncthing?.local_path || ARCHIVE_ROOT);
  }

  async request(endpoint, options = {}) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      if (this.apiKey) headers['X-API-Key'] = this.apiKey;

      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        ...options,
        headers
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Syncthing recusou a API Key. Confira a chave em Ações -> Configurações -> GUI.');
        }
        throw new Error(`Syncthing ${endpoint} falhou com HTTP ${response.status}.`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`Syncthing inacessível em ${this.apiUrl}. Verifique se o serviço está aberto e se a API GUI está ativa.`);
      }
      throw error;
    }
  }

  async status() {
    return this.request('/rest/system/status');
  }

  async connections() {
    return this.request('/rest/system/connections');
  }

  async devices() {
    const config = await this.request('/rest/config');
    return config.devices || [];
  }

  async folderStatus(folderId = this.folderId) {
    return this.request(`/rest/db/status?folder=${encodeURIComponent(folderId)}`);
  }

  async scan(folderId = this.folderId) {
    return this.request(`/rest/db/scan?folder=${encodeURIComponent(folderId)}`, { method: 'POST' });
  }

  async getFolder(folderId = this.folderId) {
    const config = await this.request('/rest/config');
    return (config.folders || []).find(folder => folder.id === folderId) || null;
  }

  async ensureFolder(folderPath = this.folderPath, folderId = this.folderId) {
    ensureDir(folderPath);
    const config = await this.request('/rest/config');
    const devices = (config.devices || []).map(device => ({ deviceID: device.deviceID }));
    const folders = config.folders || [];
    const index = folders.findIndex(folder => folder.id === folderId);

    if (index === -1) {
      folders.push({
        id: folderId,
        label: 'SaveSync',
        path: path.resolve(folderPath),
        type: 'sendreceive',
        devices
      });
      config.folders = folders;
      await this.request('/rest/config', { method: 'PUT', body: JSON.stringify(config) });
      return folders.at(-1);
    }

    const folder = folders[index];
    const knownDevices = new Set((folder.devices || []).map(device => device.deviceID));
    const mergedDevices = [
      ...(folder.devices || []),
      ...devices.filter(device => !knownDevices.has(device.deviceID))
    ];
    const nextFolder = {
      ...folder,
      label: folder.label || 'SaveSync',
      path: path.resolve(folder.path || folderPath),
      type: folder.type || 'sendreceive',
      devices: mergedDevices
    };

    if (JSON.stringify(folder) !== JSON.stringify(nextFolder)) {
      folders[index] = nextFolder;
      config.folders = folders;
      await this.request('/rest/config', { method: 'PUT', body: JSON.stringify(config) });
    }
    return nextFolder;
  }

  async syncFolder(folderPath = this.folderPath, folderId = this.folderId) {
    if (!this.enabled) {
      return { online: false, disabled: true, folder: null, scan: null };
    }
    const folder = await this.ensureFolder(folderPath, folderId);
    const scan = await this.scan(folderId);
    return { folder, scan };
  }
}

export default SyncthingClient;
