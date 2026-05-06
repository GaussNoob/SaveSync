import { defineStore } from 'pinia';
import { api } from '../api.js';

export const useGamesStore = defineStore('games', {
  state: () => ({ games: [], loading: false }),
  actions: {
    async load() {
      this.loading = true;
      this.games = await api('/games').finally(() => { this.loading = false; });
    }
  }
});
