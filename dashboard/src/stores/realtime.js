import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useWebSocket } from '@vueuse/core';
import { api, getApiBaseUrl, getApiToken } from '../api.js';

export const useRealtimeStore = defineStore('realtime', () => {
  const endpoint = ref(getApiBaseUrl());
  const logs = ref([]);
  const syncState = ref('idle');
  const syncMessage = ref('Aguardando atividade');
  const lastEventAt = ref(null);
  const protocols = ['savesync'];
  let idleTimer = null;

  updateProtocols();

  const socketUrl = computed(() => buildSocketUrl(endpoint.value));
  const { data, status, open, close } = useWebSocket(socketUrl, {
    immediate: false,
    autoConnect: false,
    autoReconnect: {
      retries: 8,
      delay: retries => Math.min(1000 * (retries + 1), 8000)
    },
    protocols
  });

  watch(data, payload => {
    if (!payload) return;
    try {
      const message = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (message.type === 'rclone-log' && message.entry) ingest(message.entry);
    } catch {
      // Ignore messages from extensions or proxies that are not SaveSync events.
    }
  });

  function ingest(entry) {
    const normalized = {
      ts: entry.ts || new Date().toISOString(),
      level: entry.level || 'info',
      message: String(entry.message || '')
    };
    logs.value = [...logs.value, normalized].slice(-100);
    lastEventAt.value = normalized.ts;

    if (normalized.level === 'error') {
      markError(normalized.message);
      return;
    }
    markSyncing(normalized.message || 'Sincronização em andamento');
  }

  async function loadLogs() {
    const payload = await api('/cloud/log').catch(() => ({ live: [], db: [] }));
    const source = payload.live?.length ? payload.live : payload.db || [];
    logs.value = source.slice(-100).map(entry => ({
      ts: entry.ts || entry.created_at,
      level: entry.level || 'info',
      message: entry.message || ''
    }));
  }

  function connect() {
    endpoint.value = getApiBaseUrl();
    updateProtocols();
    void loadLogs();
    open();
  }

  function reconnect() {
    close();
    endpoint.value = getApiBaseUrl();
    updateProtocols();
    window.setTimeout(open, 0);
  }

  function markSyncing(message = 'Sincronização em andamento') {
    window.clearTimeout(idleTimer);
    syncState.value = 'syncing';
    syncMessage.value = message;
    idleTimer = window.setTimeout(() => {
      syncState.value = 'idle';
      syncMessage.value = 'Sincronização concluída';
    }, 1800);
  }

  function markIdle(message = 'Tudo em dia') {
    window.clearTimeout(idleTimer);
    syncState.value = 'idle';
    syncMessage.value = message;
  }

  function markError(message = 'Falha na sincronização') {
    window.clearTimeout(idleTimer);
    syncState.value = 'error';
    syncMessage.value = message;
    idleTimer = window.setTimeout(() => {
      syncState.value = 'idle';
      syncMessage.value = 'Aguardando nova tentativa';
    }, 6000);
  }

  function updateProtocols() {
    const token = getApiToken();
    protocols.splice(0, protocols.length, 'savesync');
    if (token) protocols.push('savesync-token.' + encodeToken(token));
  }

  return {
    logs,
    status,
    syncState,
    syncMessage,
    lastEventAt,
    connect,
    reconnect,
    loadLogs,
    markSyncing,
    markIdle,
    markError
  };
});

function buildSocketUrl(apiBase) {
  const base = String(apiBase || '/api');
  if (/^https?:\/\//i.test(base)) {
    const parsed = new URL(base);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = parsed.pathname.replace(/\/api\/?$/, '') + '/ws/rclone';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + window.location.host + '/ws/rclone';
}
function encodeToken(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
