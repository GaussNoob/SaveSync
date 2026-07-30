<script setup>
import { computed, onMounted, ref } from 'vue';
import {
  Archive,
  Cloud,
  Database,
  FolderSync,
  Gamepad2,
  HardDrive,
  KeyRound,
  Network,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings as SettingsIcon,
  Shield,
  TestTube,
  TriangleAlert,
  Wifi,
  WifiOff
} from '@lucide/vue';
import { SwitchRoot, SwitchThumb } from 'radix-vue';
import {
  api,
  getApiBaseUrl,
  getApiToken,
  getDefaultApiBaseUrl,
  setApiBaseUrl,
  setApiToken
} from '../api.js';
import { useRealtimeStore } from '../stores/realtime.js';
import { useUiStore } from '../stores/ui.js';
import CloudProviderCard from '../components/CloudProviderCard.vue';
import EmptyState from '../components/EmptyState.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import StatusBadge from '../components/StatusBadge.vue';

const emit = defineEmits(['changed', 'open-add-game']);
const ui = useUiStore();
const realtime = useRealtimeStore();
const activeTab = ref('general');
const status = ref({ games: [], syncthing: { online: false } });
const cloudProviders = ref([]);
const statusLoading = ref(true);
const cloudLoading = ref(true);
const pageError = ref('');
const savingPreferences = ref(false);
const savingP2p = ref(false);
const testingP2p = ref(false);
const preparingP2p = ref(false);
const syncingP2p = ref(false);
const backupForm = ref({ version_limit: 10 });
const p2pForm = ref({
  enabled: true,
  api_url: 'http://localhost:8384',
  api_key: '',
  folder_id: 'savesync-folder',
  local_path: ''
});
const defaultApiEndpoint = getDefaultApiBaseUrl();
const apiEndpoint = ref(getApiBaseUrl());
const apiToken = ref(getApiToken());

const settingsNavigation = [
  { id: 'general', label: 'Geral', description: 'API, retenção e fontes', icon: SettingsIcon },
  { id: 'p2p', label: 'P2P', description: 'Syncthing e dispositivos', icon: Network },
  { id: 'cloud', label: 'Nuvem', description: 'Rclone e Google Drive', icon: Cloud }
];

const monitoredCount = computed(() => status.value.games?.filter(game => game.enabled).length || 0);
const pendingCount = computed(() => status.value.games?.filter(game => !game.enabled).length || 0);
const availablePendingCount = computed(() => (
  status.value.games?.filter(game => !game.enabled && game.source_available).length || 0
));
const unavailablePendingCount = computed(() => (
  status.value.games?.filter(game => !game.enabled && !game.source_available).length || 0
));
const apiEndpointIsDefault = computed(() => apiEndpoint.value === defaultApiEndpoint);
const syncthingState = computed(() => {
  if (status.value.syncthing?.disabled || status.value.syncthing?.enabled === false) return 'Desativado';
  return status.value.syncthing?.online ? 'Conectado' : 'Aguardando';
});
const syncthingTone = computed(() => {
  if (status.value.syncthing?.enabled === false) return 'neutral';
  return status.value.syncthing?.online ? 'success' : 'warning';
});
const syncthingDevices = computed(() => status.value.syncthing?.syncthing_devices || []);
const connectedP2pDevices = computed(() => {
  const connections = status.value.syncthing?.connections?.connections || {};
  return Object.values(connections).filter(connection => connection.connected).length;
});
const p2pFolderState = computed(() => {
  if (status.value.syncthing?.folder_status?.state) return status.value.syncthing.folder_status.state;
  if (status.value.syncthing?.folder) return 'Preparada';
  return 'Não preparada';
});
const p2pHealthLabel = computed(() => {
  if (!p2pForm.value.enabled) return 'P2P desativado';
  if (status.value.syncthing?.online && status.value.syncthing?.folder) return 'Pronto';
  if (status.value.syncthing?.online) return 'Pasta pendente';
  return 'Aguardando';
});
const p2pDevices = computed(() => {
  const connections = status.value.syncthing?.connections?.connections || {};
  return syncthingDevices.value.map(device => ({
    id: device.deviceID,
    name: device.name || device.deviceID?.slice(0, 7) || 'Dispositivo',
    connected: Boolean(connections[device.deviceID]?.connected)
  }));
});
const logRows = computed(() => realtime.logs.slice(-80));

async function loadStatus() {
  statusLoading.value = true;
  pageError.value = '';
  try {
    status.value = await api('/status');
    backupForm.value.version_limit = status.value.preferences?.version_limit || 10;
    p2pForm.value = {
      enabled: status.value.syncthing?.enabled !== false,
      api_url: status.value.syncthing?.api_url || 'http://localhost:8384',
      api_key: '',
      folder_id: status.value.syncthing?.folder_id || 'savesync-folder',
      local_path: status.value.syncthing?.local_path || status.value.syncthing?.folder_path || ''
    };
  } catch (requestError) {
    pageError.value = requestError.message;
    status.value = { games: [], syncthing: { online: false } };
  } finally {
    statusLoading.value = false;
  }
}

async function syncNow() {
  if (syncingP2p.value) return;
  syncingP2p.value = true;
  realtime.markSyncing('Arquivando saves e solicitando scan P2P');
  ui.notify({
    title: 'Sincronização P2P iniciada',
    description: 'Os snapshots locais estão sendo enviados ao Syncthing.'
  });
  try {
    const result = await api('/status/sync', { method: 'POST', timeoutMs: 30 * 60_000 });
    const archived = result.local?.archived?.length || 0;
    const p2pMessage = result.syncthing?.error
      ? result.syncthing.error
      : 'Scan solicitado ao Syncthing.';
    realtime.markIdle('Sincronização P2P concluída');
    ui.notify({
      title: 'Sincronização concluída',
      description: archived + ' fonte(s) arquivada(s). ' + p2pMessage,
      tone: result.syncthing?.error ? 'warning' : 'success'
    });
    await loadStatus();
    emit('changed');
  } catch (requestError) {
    realtime.markError(requestError.message);
    notifyError('Falha na sincronização P2P', requestError);
  } finally {
    syncingP2p.value = false;
  }
}

async function monitorPending() {
  const pending = status.value.games?.filter(game => !game.enabled && game.source_available) || [];
  if (!pending.length) {
    ui.notify({
      title: 'Nenhuma fonte disponível',
      description: 'Os caminhos pendentes não estão acessíveis neste dispositivo.',
      tone: 'warning'
    });
    return;
  }
  const previous = pending.map(game => ({ game, enabled: game.enabled }));
  pending.forEach(game => { game.enabled = true; });
  try {
    const result = await api('/games/enable-bulk', {
      method: 'POST',
      body: JSON.stringify({
        games: pending.map(game => ({
          id: game.id,
          monitor_mode: game.cloud_status === 'enabled' ? 'readonly' : 'sync'
        }))
      })
    });
    const rejected = result.rejected || [];
    ui.notify({
      title: rejected.length ? 'Ativação concluída com ressalvas' : 'Fontes ativadas',
      description: (result.updated?.length || 0) + ' fonte(s) agora estão sob monitoramento.' +
        (rejected.length ? ' ' + rejected.length + ' não puderam ser ativadas.' : ''),
      tone: rejected.length ? 'warning' : 'success'
    });
    await loadStatus();
    emit('changed');
  } catch (requestError) {
    previous.forEach(item => { item.game.enabled = item.enabled; });
    notifyError('Não foi possível ativar as fontes', requestError);
  }
}

async function savePreferences() {
  const limit = Number(backupForm.value.version_limit);
  if (!Number.isFinite(limit) || limit < 1) {
    ui.notify({
      title: 'Limite inválido',
      description: 'Informe pelo menos uma versão por jogo.',
      tone: 'error'
    });
    return;
  }
  savingPreferences.value = true;
  try {
    const result = await api('/status/preferences', {
      method: 'POST',
      body: JSON.stringify({ version_limit: Math.floor(limit) })
    });
    backupForm.value.version_limit = result.preferences.version_limit;
    ui.notify({
      title: 'Retenção atualizada',
      description: result.removed_count
        ? result.removed_count + ' backup(s) antigo(s) removido(s).'
        : 'Nenhum backup precisou ser removido.',
      tone: 'success'
    });
    await loadStatus();
    emit('changed');
  } catch (requestError) {
    notifyError('Não foi possível salvar a retenção', requestError);
  } finally {
    savingPreferences.value = false;
  }
}

async function saveApiEndpoint() {
  try {
    apiEndpoint.value = setApiBaseUrl(apiEndpoint.value);
    apiToken.value = setApiToken(apiToken.value);
    realtime.reconnect();
    ui.notify({
      title: 'Acesso à API atualizado',
      description: apiEndpoint.value,
      tone: 'success'
    });
    await Promise.all([loadStatus(), loadCloudProviders()]);
    emit('changed');
  } catch (requestError) {
    notifyError('Endpoint da API inválido', requestError);
  }
}

async function resetApiEndpoint() {
  apiEndpoint.value = setApiBaseUrl('');
  realtime.reconnect();
  ui.notify({
    title: 'Endpoint padrão restaurado',
    description: apiEndpoint.value,
    tone: 'success'
  });
  await Promise.all([loadStatus(), loadCloudProviders()]);
  emit('changed');
}

function p2pPayload() {
  return {
    enabled: p2pForm.value.enabled,
    api_url: p2pForm.value.api_url,
    api_key: p2pForm.value.api_key,
    folder_id: p2pForm.value.folder_id,
    local_path: p2pForm.value.local_path
  };
}

async function saveP2pSettings({ throwOnError = false, notify = true } = {}) {
  savingP2p.value = true;
  try {
    const result = await api('/status/syncthing', {
      method: 'POST',
      body: JSON.stringify(p2pPayload())
    });
    p2pForm.value.api_key = '';
    if (notify) {
      ui.notify({
        title: 'Configuração P2P salva',
        description: 'As próximas sincronizações usarão estes parâmetros.',
        tone: 'success'
      });
    }
    await loadStatus();
    emit('changed');
    return result;
  } catch (requestError) {
    if (!throwOnError) notifyError('Não foi possível salvar o P2P', requestError);
    if (throwOnError) throw requestError;
    return null;
  } finally {
    savingP2p.value = false;
  }
}

async function testP2pSettings() {
  testingP2p.value = true;
  try {
    const result = await api('/status/syncthing/test', {
      method: 'POST',
      body: JSON.stringify(p2pPayload())
    });
    ui.notify({
      title: result.online ? 'Syncthing conectado' : 'P2P desativado',
      description: result.online
        ? (result.devices?.length || 0) + ' dispositivo(s) configurado(s).'
        : result.message || 'A integração não está ativa.',
      tone: result.online ? 'success' : 'warning'
    });
    await loadStatus();
  } catch (requestError) {
    notifyError('Teste do Syncthing falhou', requestError);
  } finally {
    testingP2p.value = false;
  }
}

async function prepareP2pFolder() {
  preparingP2p.value = true;
  try {
    await saveP2pSettings({ throwOnError: true, notify: false });
    const result = await api('/status/syncthing/folder', { method: 'POST', timeoutMs: 60_000 });
    ui.notify({
      title: 'Pasta P2P preparada',
      description: result.folder?.label || result.folder?.id || p2pForm.value.folder_id,
      tone: 'success'
    });
    await loadStatus();
  } catch (requestError) {
    notifyError('Não foi possível preparar a pasta', requestError);
  } finally {
    preparingP2p.value = false;
  }
}

async function loadCloudProviders() {
  cloudLoading.value = true;
  try {
    const payload = await api('/cloud/auth/providers', { timeoutMs: 2 * 60_000 });
    cloudProviders.value = payload.providers;
  } catch (requestError) {
    cloudProviders.value = [{
      id: 'google-drive',
      name: 'Google Drive',
      icon: 'google-drive',
      connected: false,
      error: requestError.message
    }];
  } finally {
    cloudLoading.value = false;
  }
}

async function refreshCloudProviders() {
  await loadCloudProviders();
  await realtime.loadLogs();
  emit('changed');
}

function notifyError(title, requestError) {
  ui.notify({
    title,
    description: requestError.message || String(requestError),
    tone: 'error'
  });
}

function formatLogTime(value) {
  if (!value) return '--:--:--';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(11, 19)
    : date.toLocaleTimeString('pt-BR', { hour12: false });
}

onMounted(() => {
  void loadStatus();
  void loadCloudProviders();
});
</script>

<template>
  <section class="view settings-view">
    <div v-if="pageError" class="inline-alert" data-tone="danger">
      <TriangleAlert :size="16" />
      <div>
        <strong>O backend não respondeu</strong>
        <span>{{ pageError }}</span>
      </div>
      <button class="button button-secondary" @click="loadStatus">Tentar novamente</button>
    </div>

    <div class="settings-layout">
      <aside class="panel settings-navigation">
        <span class="nav-section-label">Configurações</span>
        <button
          v-for="item in settingsNavigation"
          :key="item.id"
          :class="{ active: activeTab === item.id }"
          @click="activeTab = item.id"
        >
          <component :is="item.icon" :size="16" :stroke-width="1.6" />
          <span>
            <strong>{{ item.label }}</strong>
            <small>{{ item.description }}</small>
          </span>
        </button>
        <div class="settings-nav-status">
          <span>
            <Server :size="13" />
            API
          </span>
          <StatusBadge :type="pageError ? 'danger' : 'success'">
            {{ pageError ? 'Offline' : 'Online' }}
          </StatusBadge>
        </div>
      </aside>

      <main class="settings-content">
        <template v-if="statusLoading && activeTab !== 'cloud'">
          <section v-for="index in 3" :key="index" class="panel skeleton-panel">
            <SkeletonBlock width="180px" height="12px" />
            <SkeletonBlock height="38px" />
            <SkeletonBlock width="72%" height="38px" />
          </section>
        </template>

        <template v-else-if="activeTab === 'general'">
          <section class="panel settings-section">
            <header class="settings-section-header">
              <span class="settings-section-icon"><Server :size="16" /></span>
              <div>
                <h2>Acesso à API</h2>
                <p>Endpoint usado pelo dashboard, Electron e clientes móveis.</p>
              </div>
              <StatusBadge :type="apiEndpointIsDefault ? 'neutral' : 'accent'">
                {{ apiEndpointIsDefault ? 'Padrão' : 'Personalizado' }}
              </StatusBadge>
            </header>
            <div class="settings-form-grid">
              <label class="settings-field">
                <span>Endpoint</span>
                <input v-model.trim="apiEndpoint" :placeholder="defaultApiEndpoint" inputmode="url" />
                <small>Em emuladores Android, 10.0.2.2 alcança o backend do computador.</small>
              </label>
              <label class="settings-field">
                <span>Token da API</span>
                <div class="input-with-icon">
                  <KeyRound :size="14" />
                  <input
                    v-model.trim="apiToken"
                    type="password"
                    placeholder="SAVESYNC_API_TOKEN"
                    autocomplete="off"
                  />
                </div>
                <small>Use o mesmo valor configurado no servidor quando houver exposição em rede.</small>
              </label>
            </div>
            <footer class="settings-section-actions">
              <button class="button button-primary" @click="saveApiEndpoint">
                <Save :size="14" />
                Salvar acesso
              </button>
              <button class="button button-ghost" @click="resetApiEndpoint">Usar padrão</button>
            </footer>
          </section>

          <div class="settings-two-column">
            <section class="panel settings-section">
              <header class="settings-section-header">
                <span class="settings-section-icon"><Archive :size="16" /></span>
                <div>
                  <h2>Retenção de versões</h2>
                  <p>Limite de snapshots mantidos por jogo.</p>
                </div>
              </header>
              <div class="settings-section-body">
                <label class="settings-field">
                  <span>Backups por jogo</span>
                  <div class="input-suffix compact-input">
                    <input
                      v-model.number="backupForm.version_limit"
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      :disabled="savingPreferences"
                    />
                    <span>versões</span>
                  </div>
                  <small>Versões acima do limite são removidas começando pelas mais antigas.</small>
                </label>
                <div class="settings-data-rows">
                  <div>
                    <span>Sync ao alterar</span>
                    <strong>{{ status.preferences?.sync_on_change === false ? 'Desativada' : 'Ativa' }}</strong>
                  </div>
                  <div>
                    <span>Notificações</span>
                    <strong>{{ status.preferences?.notify_desktop === false ? 'Desativadas' : 'Desktop' }}</strong>
                  </div>
                </div>
              </div>
              <footer class="settings-section-actions">
                <button class="button button-secondary" :disabled="savingPreferences" @click="savePreferences">
                  <Save :size="14" />
                  {{ savingPreferences ? 'Salvando…' : 'Salvar retenção' }}
                </button>
              </footer>
            </section>

            <section class="panel settings-section">
              <header class="settings-section-header">
                <span class="settings-section-icon"><Gamepad2 :size="16" /></span>
                <div>
                  <h2>Fontes de save</h2>
                  <p>Disponibilidade e monitoramento local.</p>
                </div>
                <StatusBadge type="neutral">{{ status.games?.length || 0 }} fontes</StatusBadge>
              </header>
              <div class="source-stats">
                <div>
                  <strong>{{ monitoredCount }}</strong>
                  <span>Monitoradas</span>
                </div>
                <div>
                  <strong>{{ pendingCount }}</strong>
                  <span>Pendentes</span>
                </div>
                <div>
                  <strong>{{ unavailablePendingCount }}</strong>
                  <span>Indisponíveis</span>
                </div>
              </div>
              <footer class="settings-section-actions">
                <button
                  v-if="pendingCount"
                  class="button button-secondary"
                  :disabled="!availablePendingCount"
                  @click="monitorPending"
                >
                  <HardDrive :size="14" />
                  Monitorar disponíveis
                </button>
                <button class="button button-primary" @click="emit('open-add-game')">
                  <Plus :size="14" />
                  Adicionar fonte
                </button>
              </footer>
            </section>
          </div>

          <section class="panel settings-section compact-service">
            <header class="settings-section-header">
              <span class="settings-section-icon">
                <Wifi v-if="status.syncthing?.online" :size="16" />
                <WifiOff v-else :size="16" />
              </span>
              <div>
                <h2>Syncthing</h2>
                <p>{{ status.syncthing?.folder_path || 'Pasta P2P ainda não preparada' }}</p>
              </div>
              <StatusBadge :type="syncthingTone">{{ syncthingState }}</StatusBadge>
              <button class="button button-secondary" @click="activeTab = 'p2p'">Configurar P2P</button>
            </header>
          </section>
        </template>

        <template v-else-if="activeTab === 'p2p'">
          <section class="p2p-status-strip panel">
            <div>
              <span>Estado</span>
              <strong>{{ p2pHealthLabel }}</strong>
            </div>
            <div>
              <span>Dispositivos</span>
              <strong>{{ connectedP2pDevices }}/{{ syncthingDevices.length }}</strong>
            </div>
            <div>
              <span>Pasta</span>
              <strong>{{ p2pFolderState }}</strong>
            </div>
            <div>
              <span>API Syncthing</span>
              <strong>{{ status.syncthing?.online ? 'Online' : 'Offline' }}</strong>
            </div>
          </section>

          <div class="p2p-config-grid">
            <section class="panel settings-section">
              <header class="settings-section-header">
                <span class="settings-section-icon"><Network :size="16" /></span>
                <div>
                  <h2>Conexão</h2>
                  <p>API local usada para scans e dispositivos.</p>
                </div>
                <StatusBadge :type="status.syncthing?.api_key_set ? 'success' : 'warning'">
                  {{ status.syncthing?.api_key_set ? 'Key salva' : 'Sem key' }}
                </StatusBadge>
              </header>
              <div class="settings-section-body p2p-form">
                <label class="settings-toggle-row">
                  <span>
                    <strong>P2P ativo</strong>
                    <small>Solicita scan após criar snapshots locais.</small>
                  </span>
                  <SwitchRoot v-model:checked="p2pForm.enabled" class="switch-root">
                    <SwitchThumb class="switch-thumb" />
                  </SwitchRoot>
                </label>
                <label class="settings-field">
                  <span>URL da API Syncthing</span>
                  <input v-model.trim="p2pForm.api_url" placeholder="http://localhost:8384" inputmode="url" />
                </label>
                <label class="settings-field">
                  <span>Chave da API</span>
                  <input
                    v-model.trim="p2pForm.api_key"
                    type="password"
                    :placeholder="status.syncthing?.api_key_set ? 'Manter chave atual' : 'Cole a API Key do Syncthing'"
                    autocomplete="off"
                  />
                  <small>Disponível em Actions → Settings → GUI → API Key.</small>
                </label>
              </div>
            </section>

            <section class="panel settings-section">
              <header class="settings-section-header">
                <span class="settings-section-icon"><FolderSync :size="16" /></span>
                <div>
                  <h2>Pasta compartilhada</h2>
                  <p>Identidade e arquivo local de versões.</p>
                </div>
                <StatusBadge type="accent">{{ p2pForm.folder_id || 'savesync-folder' }}</StatusBadge>
              </header>
              <div class="settings-section-body p2p-form">
                <label class="settings-field">
                  <span>ID da pasta</span>
                  <input v-model.trim="p2pForm.folder_id" placeholder="savesync-folder" />
                  <small>Use o mesmo ID em todos os dispositivos.</small>
                </label>
                <div class="settings-field">
                  <span>Arquivo local</span>
                  <div class="settings-code-value">
                    <code>{{ p2pForm.local_path || 'Aguardando configuração do backend' }}</code>
                  </div>
                  <small>Gerenciado pelo SaveSync e usado como origem do Syncthing.</small>
                </div>
              </div>
            </section>
          </div>

          <div class="p2p-command-bar panel">
            <div>
              <Shield :size="15" />
              <span>Salve e teste a conexão antes de preparar a pasta.</span>
            </div>
            <button class="button button-secondary" :disabled="savingP2p" @click="saveP2pSettings()">
              <Save :size="14" />
              {{ savingP2p ? 'Salvando…' : 'Salvar' }}
            </button>
            <button class="button button-secondary" :disabled="testingP2p" @click="testP2pSettings">
              <TestTube :size="14" />
              {{ testingP2p ? 'Testando…' : 'Testar API' }}
            </button>
            <button
              class="button button-secondary"
              :disabled="preparingP2p || !p2pForm.enabled"
              @click="prepareP2pFolder"
            >
              <FolderSync :size="14" />
              {{ preparingP2p ? 'Preparando…' : 'Preparar pasta' }}
            </button>
            <button class="button button-primary" :disabled="syncingP2p || !p2pForm.enabled" @click="syncNow">
              <RefreshCw :size="14" :class="{ spinning: syncingP2p }" />
              Sincronizar
            </button>
          </div>

          <section class="panel p2p-devices-panel">
            <header class="panel-header">
              <div>
                <h2 class="panel-title">Dispositivos Syncthing</h2>
                <p class="panel-description">Conexões retornadas pela API local</p>
              </div>
              <StatusBadge type="neutral">{{ p2pDevices.length }} cadastrados</StatusBadge>
            </header>
            <div v-if="p2pDevices.length" class="p2p-device-list">
              <div v-for="device in p2pDevices" :key="device.id" class="p2p-device-row">
                <span class="device-status-dot" :data-online="device.connected"></span>
                <span>
                  <strong>{{ device.name }}</strong>
                  <code>{{ device.id }}</code>
                </span>
                <StatusBadge :type="device.connected ? 'success' : 'neutral'">
                  {{ device.connected ? 'Online' : 'Offline' }}
                </StatusBadge>
              </div>
            </div>
            <EmptyState
              v-else
              compact
              :icon="Network"
              title="Nenhum dispositivo retornado"
              description="Cadastre dispositivos na interface do Syncthing e teste novamente."
            />
            <div v-if="status.syncthing?.error" class="settings-inline-error">
              <code>{{ status.syncthing.error }}</code>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="cloud-heading panel">
            <div>
              <span class="settings-section-icon"><Cloud :size="16" /></span>
              <span>
                <strong>Backup em nuvem</strong>
                <small>Rclone bisync com feedback em tempo real.</small>
              </span>
            </div>
            <StatusBadge :type="realtime.status === 'OPEN' ? 'success' : 'warning'">
              WebSocket {{ realtime.status === 'OPEN' ? 'online' : 'offline' }}
            </StatusBadge>
          </section>

          <section v-if="cloudLoading" class="panel skeleton-panel cloud-provider-skeleton">
            <SkeletonBlock width="190px" height="12px" />
            <SkeletonBlock height="48px" />
            <SkeletonBlock height="38px" />
          </section>
          <CloudProviderCard
            v-for="provider in cloudProviders"
            v-else
            :key="provider.id"
            :provider="provider"
            @connect="refreshCloudProviders"
            @disconnect="refreshCloudProviders"
            @sync-now="refreshCloudProviders"
            @updated="refreshCloudProviders"
          />

          <section class="panel cloud-log-panel">
            <header class="panel-header">
              <div>
                <h2 class="panel-title">Log do rclone</h2>
                <p class="panel-description">Saída persistida e eventos recebidos por WebSocket</p>
              </div>
              <button class="button button-ghost" @click="realtime.loadLogs">
                <RefreshCw :size="13" />
                Atualizar
              </button>
            </header>
            <div v-if="logRows.length" class="cloud-log" role="log" aria-live="polite">
              <div v-for="(entry, index) in logRows" :key="entry.ts + '-' + index" :data-level="entry.level">
                <time>{{ formatLogTime(entry.ts) }}</time>
                <span>{{ entry.level }}</span>
                <code>{{ entry.message }}</code>
              </div>
            </div>
            <EmptyState
              v-else
              compact
              :icon="Database"
              title="Nenhum log registrado"
              description="A saída do rclone aparecerá aqui na próxima autenticação ou sincronização."
            />
          </section>
        </template>
      </main>
    </div>
  </section>
</template>
