import { defineStore } from 'pinia';
import { api } from '../api.js';

export const useSyncStore = defineStore('sync', {
  state: () => ({ status: { syncthing: { online: false } }, conflicts: [] }),
  actions: {
    async refresh() {
      const [status, conflicts] = await Promise.all([
        api('/status').catch(() => ({ syncthing: { online: false }, games: [] })),
        api('/conflicts').catch(() => [])
      ]);
      this.status = status;
      this.conflicts = conflicts;
    }
  }
});
