import { defineStore } from 'pinia';
import { api } from '../api.js';

export const useCloudStore = defineStore('cloud', {
  state: () => ({ status: null, log: [], running: false }),
  actions: {
    async load() {
      this.status = await api('/cloud/status').catch(error => ({ connected: false, error: error.message }));
      const log = await api('/cloud/log').catch(() => ({ live: [], db: [] }));
      this.log = log.live?.length ? log.live : log.db || [];
    },
    async syncNow() {
      this.running = true;
      try {
        await api('/cloud/sync-now', { method: 'POST' });
      } finally {
        this.running = false;
      }
      await this.load();
    }
  }
});
