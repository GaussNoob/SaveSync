<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, getApiBaseUrl, getDefaultApiBaseUrl, setApiBaseUrl } from '../api.js';
import CloudProviderCard from '../components/CloudProviderCard.vue';

const emit = defineEmits(['changed', 'open-add-game']);
const activeTab = ref('general');
const message = ref('');
const status = ref({ games: [], syncthing: { online: false } });
const cloudProviders = ref([]);
const savingPreferences = ref(false);
const savingP2p = ref(false);
const testingP2p = ref(false);
const preparingP2p = ref(false);
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

const monitoredCount = computed(() => status.value.games?.filter(game => game.enabled).length || 0);
const pendingCount = computed(() => status.value.games?.filter(game => !game.enabled).length || 0);
const availablePendingCount = computed(() => status.value.games?.filter(game => !game.enabled && game.source_available).length || 0);
const unavailablePendingCount = computed(() => status.value.games?.filter(game => !game.enabled && !game.source_available).length || 0);
const syncthingState = computed(() => {
  if (status.value.syncthing?.disabled || status.value.syncthing?.enabled === false) return 'Desativado';
  return status.value.syncthing?.online ? 'Conectado' : 'Aguardando';
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
const p2pHealthClass = computed(() => {
  if (!p2pForm.value.enabled) return 'is-off';
  if (status.value.syncthing?.online && status.value.syncthing?.folder) return 'is-ok';
  if (status.value.syncthing?.online) return 'is-warn';
  return 'is-error';
});
const p2pHealthLabel = computed(() => {
  if (!p2pForm.value.enabled) return 'P2P desativado';
  if (status.value.syncthing?.online && status.value.syncthing?.folder) return 'Pronto para sincronizar';
  if (status.value.syncthing?.online) return 'API conectada, pasta pendente';
  return 'Aguardando Syncthing';
});
const p2pDevices = computed(() => {
  const connections = status.value.syncthing?.connections?.connections || {};
  return syncthingDevices.value.map(device => ({
    id: device.deviceID,
    name: device.name || device.deviceID?.slice(0, 7) || 'Dispositivo',
    connected: Boolean(connections[device.deviceID]?.connected)
  }));
});

async function syncNow() {
  try {
    const result = await api('/status/sync', { method: 'POST' });
    const local = result.local.archived.length
      ? `${result.local.archived.length} fonte(s) arquivada(s) localmente`
      : 'Nenhuma fonte monitorada foi arquivada';
    const p2p = result.syncthing?.error ? `P2P pendente: ${result.syncthing.error}` : 'P2P enviado ao Syncthing';
    message.value = `${local}. ${p2p}.`;
    await loadStatus();
  } catch (error) {
    message.value = error.message;
  }
}

async function loadStatus() {
  status.value = await api('/status').catch(() => ({ games: [], syncthing: { online: false } }));
  backupForm.value.version_limit = status.value.preferences?.version_limit || 10;
  p2pForm.value = {
    enabled: status.value.syncthing?.enabled !== false,
    api_url: status.value.syncthing?.api_url || 'http://localhost:8384',
    api_key: '',
    folder_id: status.value.syncthing?.folder_id || 'savesync-folder',
    local_path: status.value.syncthing?.local_path || status.value.syncthing?.folder_path || ''
  };
}

async function monitorPending() {
  const pending = status.value.games?.filter(game => !game.enabled && game.source_available) || [];
  if (!pending.length) {
    message.value = 'Nenhuma fonte pendente com caminho local válido.';
    return;
  }
  try {
    await Promise.all(pending.map(game => api(`/games/${game.id}/enable`, {
      method: 'POST',
      body: JSON.stringify({ monitor_mode: game.cloud_status === 'enabled' ? 'readonly' : 'sync' })
    })));
    const unavailable = unavailablePendingCount.value;
    message.value = `${pending.length} fonte(s) ativada(s) para monitoramento.${unavailable ? ` ${unavailable} sem caminho local válido.` : ''}`;
    await loadStatus();
    emit('changed');
  } catch (error) {
    message.value = error.message;
  }
}

async function savePreferences() {
  const limit = Number(backupForm.value.version_limit);
  if (!Number.isFinite(limit) || limit < 1) {
    message.value = 'O limite de backups precisa ser de pelo menos 1.';
    return;
  }

  savingPreferences.value = true;
  try {
    const result = await api('/status/preferences', {
      method: 'POST',
      body: JSON.stringify({ version_limit: Math.floor(limit) })
    });
    backupForm.value.version_limit = result.preferences.version_limit;
    message.value = result.removed_count
      ? `Limite salvo. ${result.removed_count} backup(s) antigo(s) removido(s).`
      : 'Limite de backups salvo.';
    await loadStatus();
    emit('changed');
  } catch (error) {
    message.value = error.message;
  } finally {
    savingPreferences.value = false;
  }
}

async function saveApiEndpoint() {
  apiEndpoint.value = setApiBaseUrl(apiEndpoint.value);
  message.value = `Endpoint da API salvo: ${apiEndpoint.value}.`;
  await loadStatus();
  await loadCloudProviders();
  emit('changed');
}

async function resetApiEndpoint() {
  apiEndpoint.value = setApiBaseUrl('');
  message.value = `Endpoint da API restaurado: ${apiEndpoint.value}.`;
  await loadStatus();
  await loadCloudProviders();
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

async function saveP2pSettings({ throwOnError = false } = {}) {
  savingP2p.value = true;
  try {
    const result = await api('/status/syncthing', {
      method: 'POST',
      body: JSON.stringify(p2pPayload())
    });
    p2pForm.value.api_key = '';
    message.value = 'Configuração P2P salva.';
    await loadStatus();
    emit('changed');
    return result;
  } catch (error) {
    message.value = error.message;
    if (throwOnError) throw error;
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
    message.value = result.online
      ? `Syncthing conectado. ${result.devices?.length || 0} dispositivo(s) configurado(s).`
      : result.message || 'P2P desativado.';
    await loadStatus();
  } catch (error) {
    message.value = error.message;
  } finally {
    testingP2p.value = false;
  }
}

async function prepareP2pFolder() {
  preparingP2p.value = true;
  try {
    await saveP2pSettings({ throwOnError: true });
    const result = await api('/status/syncthing/folder', { method: 'POST' });
    message.value = `Pasta P2P pronta: ${result.folder?.label || result.folder?.id || p2pForm.value.folder_id}.`;
    await loadStatus();
  } catch (error) {
    message.value = error.message;
  } finally {
    preparingP2p.value = false;
  }
}

async function loadCloudProviders() {
  const payload = await api('/cloud/auth/providers').catch(() => ({
    providers: [{
      id: 'google-drive',
      name: 'Google Drive',
      icon: 'google-drive',
      connected: false
    }]
  }));
  cloudProviders.value = payload.providers;
}

async function refreshCloudProviders() {
  await loadCloudProviders();
  emit('changed');
}

onMounted(() => {
  loadStatus();
  loadCloudProviders();
});
</script>

<template>
  <section class="view">
    <div class="settings-tabs">
      <button :class="{ active: activeTab === 'general' }" @click="activeTab = 'general'">Geral</button>
      <button :class="{ active: activeTab === 'p2p' }" @click="activeTab = 'p2p'">P2P</button>
      <button :class="{ active: activeTab === 'cloud' }" @click="activeTab = 'cloud'">Nuvem</button>
    </div>

    <section v-if="activeTab === 'general'" class="settings-grid">
      <article class="panel settings-card">
        <div class="section-title">
          <p>Android e rede</p>
          <span class="badge badge-platform">API</span>
        </div>
        <label class="settings-field">
          <span>Endpoint da API</span>
          <input
            v-model.trim="apiEndpoint"
            :placeholder="defaultApiEndpoint"
            inputmode="url"
          />
          <small>Em emuladores Android, o padrão usa 10.0.2.2 para alcançar o backend rodando no computador.</small>
        </label>
        <div class="actions split-actions">
          <button class="outline" @click="saveApiEndpoint">Salvar endpoint</button>
          <button class="ghost" @click="resetApiEndpoint">Usar padrão</button>
        </div>
      </article>

      <article class="panel settings-card">
        <div class="section-title">
          <p>Jogos</p>
          <span class="badge badge-platform">{{ status.games?.length || 0 }} fontes</span>
        </div>
        <div class="settings-stat">
          <strong>{{ monitoredCount }}</strong>
          <span>Monitoradas</span>
        </div>
        <div class="settings-stat muted">
          <strong>{{ pendingCount }}</strong>
          <span>Pendentes</span>
        </div>
        <button v-if="pendingCount" :disabled="!availablePendingCount" @click="monitorPending">
          Monitorar disponíveis
        </button>
        <p v-if="unavailablePendingCount" class="settings-help">{{ unavailablePendingCount }} fonte(s) sem caminho local válido.</p>
        <button class="primary" @click="emit('open-add-game')">Adicionar fonte de save</button>
      </article>

      <article class="panel settings-card compact-card">
        <div class="section-title">
          <p>Syncthing</p>
          <span class="badge" :class="status.syncthing?.online ? 'badge-ok' : status.syncthing?.enabled === false ? 'badge-offline' : 'badge-pending'">{{ syncthingState }}</span>
        </div>
        <code v-if="status.syncthing?.error">{{ status.syncthing.error }}</code>
        <p v-else class="settings-help">P2P para outros PCs e celular via pasta SaveSync no Syncthing.</p>
        <code>{{ status.syncthing?.folder_path }}</code>
        <button class="action-button action-sync" @click="syncNow">Sincronizar agora</button>
      </article>

      <article class="panel settings-card">
        <div class="section-title">
          <p>Preferências</p>
        </div>
        <label class="settings-field">
          <span>Backups por jogo</span>
          <input
            v-model.number="backupForm.version_limit"
            type="number"
            min="1"
            step="1"
            :disabled="savingPreferences"
          />
          <small>Mantém só os últimos backups. Ex.: 5 apaga os mais antigos a partir do sexto.</small>
        </label>
        <button class="outline" :disabled="savingPreferences" @click="savePreferences">
          {{ savingPreferences ? 'Salvando...' : 'Salvar preferências' }}
        </button>
        <div class="settings-row">
          <span>Sincronização local</span>
          <strong>{{ status.preferences?.sync_on_change === false ? 'Desativada' : 'Ativa ao detectar mudanças' }}</strong>
        </div>
        <div class="settings-row">
          <span>Notificações</span>
          <strong>{{ status.preferences?.notify_desktop === false ? 'Desativadas' : 'Desktop' }}</strong>
        </div>
      </article>
      <p v-if="message" class="message settings-message">{{ message }}</p>
    </section>

    <section v-if="activeTab === 'p2p'" class="p2p-layout">
      <section class="p2p-hero">
        <div class="p2p-hero-main">
          <span class="p2p-kicker">Syncthing P2P</span>
          <h2>{{ p2pHealthLabel }}</h2>
          <p>{{ status.syncthing?.folder_path || p2pForm.local_path }}</p>
          <div class="p2p-health" :class="p2pHealthClass">
            <span></span>
            {{ syncthingState }}
          </div>
        </div>
        <div class="p2p-status-grid">
          <article>
            <span>Dispositivos</span>
            <strong>{{ connectedP2pDevices }}/{{ syncthingDevices.length }}</strong>
          </article>
          <article>
            <span>Pasta</span>
            <strong>{{ p2pFolderState }}</strong>
          </article>
          <article>
            <span>API</span>
            <strong>{{ status.syncthing?.online ? 'Online' : 'Offline' }}</strong>
          </article>
        </div>
      </section>

      <section class="p2p-grid">
        <article class="panel p2p-section">
          <div class="section-title">
            <p>Conexão</p>
            <span class="badge" :class="status.syncthing?.api_key_set ? 'badge-ok' : 'badge-pending'">{{ status.syncthing?.api_key_set ? 'Key salva' : 'Sem key' }}</span>
          </div>
          <label class="toggle-row p2p-toggle">
            <span>
              <strong>P2P ativo</strong>
              <small>Dispara scan no Syncthing depois de criar backups locais.</small>
            </span>
            <input v-model="p2pForm.enabled" type="checkbox" />
            <i aria-hidden="true"></i>
          </label>
          <label class="settings-field">
            <span>URL da API Syncthing</span>
            <input v-model.trim="p2pForm.api_url" placeholder="http://localhost:8384" inputmode="url" />
            <small>Use o endereço da GUI/API do Syncthing nesta máquina.</small>
          </label>
          <label class="settings-field">
            <span>Chave da API</span>
            <input v-model.trim="p2pForm.api_key" :placeholder="status.syncthing?.api_key_set ? 'Manter chave atual' : 'Cole a API Key do Syncthing'" autocomplete="off" />
            <small>Fica em Actions -> Settings -> GUI -> API Key.</small>
          </label>
        </article>

        <article class="panel p2p-section">
          <div class="section-title">
            <p>Pasta compartilhada</p>
            <span class="badge badge-platform">{{ p2pForm.folder_id || 'savesync-folder' }}</span>
          </div>
          <label class="settings-field">
            <span>ID da pasta</span>
            <input v-model.trim="p2pForm.folder_id" placeholder="savesync-folder" />
            <small>O mesmo ID deve existir nos dispositivos que compartilham saves.</small>
          </label>
          <label class="settings-field">
            <span>Pasta local P2P</span>
            <input v-model.trim="p2pForm.local_path" placeholder="/home/usuario/savesync/games" />
            <small>Arquivo de versões usado como origem para o Syncthing.</small>
          </label>
          <div class="p2p-actions">
            <button class="action-button action-monitor" :disabled="savingP2p" @click="saveP2pSettings">
              {{ savingP2p ? 'Salvando...' : 'Salvar' }}
            </button>
            <button class="action-button action-secondary" :disabled="testingP2p" @click="testP2pSettings">
              {{ testingP2p ? 'Testando...' : 'Testar' }}
            </button>
            <button class="action-button action-sync" :disabled="preparingP2p || !p2pForm.enabled" @click="prepareP2pFolder">
              {{ preparingP2p ? 'Preparando...' : 'Preparar' }}
            </button>
            <button class="action-button action-restore" :disabled="!p2pForm.enabled" @click="syncNow">Sync</button>
          </div>
        </article>
      </section>

      <section class="panel p2p-device-panel">
        <div class="section-title">
          <p>Dispositivos Syncthing</p>
          <span class="badge badge-platform">{{ p2pDevices.length }} cadastrados</span>
        </div>
        <div v-if="p2pDevices.length" class="p2p-device-list">
          <article v-for="device in p2pDevices" :key="device.id" class="p2p-device">
            <span class="status-dot" :class="{ offline: !device.connected }"></span>
            <div>
              <strong>{{ device.name }}</strong>
              <code>{{ device.id }}</code>
            </div>
            <span class="badge" :class="device.connected ? 'badge-ok' : 'badge-pending'">{{ device.connected ? 'Online' : 'Offline' }}</span>
          </article>
        </div>
        <div v-else class="empty compact-empty">Nenhum dispositivo retornado pela API Syncthing.</div>
        <code v-if="status.syncthing?.error" class="p2p-error">{{ status.syncthing.error }}</code>
        <p v-if="message" class="message">{{ message }}</p>
      </section>
    </section>

    <section v-if="activeTab === 'cloud'" class="form cloud-view">
      <h2>Nuvem</h2>
      <CloudProviderCard
        v-for="provider in cloudProviders"
        :key="provider.id"
        :provider="provider"
        @connect="refreshCloudProviders"
        @disconnect="refreshCloudProviders"
        @sync-now="refreshCloudProviders"
        @updated="refreshCloudProviders"
      />
    </section>
  </section>
</template>
