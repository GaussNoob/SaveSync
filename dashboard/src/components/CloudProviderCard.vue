<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({
  provider: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['connect', 'disconnect', 'sync-now', 'updated']);

const state = ref(props.provider.connected ? 'connected' : 'idle');
const error = ref('');
const syncing = ref(false);
const savingConfig = ref(false);
const syncSuccess = ref('');
const configSuccess = ref('');
const configForm = ref({
  remote_path: props.provider.remote_path || 'SaveSync/',
  sync_interval_minutes: props.provider.sync_interval_minutes || 5
});
let successTimeout = null;
let polling = null;
let pollCount = 0;
const MAX_POLLS = 150; // 5 minutes max polling at 2s intervals

const isConnected = computed(() => props.provider.connected);
const storageUsed = computed(() => props.provider.storage_used_label || 'Aguardando leitura');
const visibleError = computed(() => error.value || props.provider.error || '');
const lastSync = computed(() => {
  if (!props.provider.last_sync) return 'Nunca';
  try {
    const d = new Date(props.provider.last_sync);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 60000);
    if (diff < 1) return 'Agora mesmo';
    if (diff < 60) return `há ${diff} min`;
    if (diff < 1440) return `há ${Math.floor(diff / 60)}h`;
    return d.toLocaleDateString('pt-BR');
  } catch {
    return props.provider.last_sync;
  }
});

function stopPolling() {
  if (polling) clearInterval(polling);
  polling = null;
  pollCount = 0;
}

function cleanup() {
  stopPolling();
  clearTimeout(successTimeout);
}

async function pollAuthStatus() {
  pollCount++;
  if (pollCount > MAX_POLLS) {
    stopPolling();
    state.value = 'error';
    error.value = 'Tempo limite excedido. Tente novamente.';
    return;
  }

  try {
    const payload = await api('/cloud/auth/google-drive/status');

    if (payload.status === 'success') {
      stopPolling();
      state.value = 'connected';
      error.value = '';
      emit('connect');
    } else if (payload.status === 'error') {
      stopPolling();
      state.value = 'error';
      error.value = payload.error || 'Não foi possível conectar ao Google Drive.';
    } else if (payload.status === 'idle' && state.value === 'pending') {
      // Auth was reset (server restart?) — stop polling
      stopPolling();
      state.value = 'idle';
    }
    // If status is still 'pending', keep polling
  } catch (err) {
    // Network error during polling — don't stop, just log
    console.warn('Polling error:', err.message);
  }
}

function startPolling() {
  stopPolling();
  polling = setInterval(pollAuthStatus, 2000);
}

async function connect() {
  state.value = 'pending';
  error.value = '';
  try {
    const result = await api('/cloud/auth/google-drive/start', { method: 'POST' });
    if (result.status === 'already_connected') {
      state.value = 'connected';
      emit('connect');
      return;
    }
    startPolling();
  } catch (err) {
    state.value = 'error';
    error.value = typeof err === 'string' ? err : (err.message || 'Erro ao iniciar autorização.');
  }
}

async function cancel() {
  stopPolling();
  try {
    await api('/cloud/auth/google-drive', { method: 'DELETE' });
  } catch { /* ignore */ }
  state.value = 'idle';
  error.value = '';
}

async function disconnect() {
  try {
    await api('/cloud/auth/google-drive', { method: 'DELETE' });
    state.value = 'idle';
    error.value = '';
    emit('disconnect');
  } catch (err) {
    error.value = err.message || 'Erro ao desconectar.';
  }
}

async function syncNow() {
  syncing.value = true;
  error.value = '';
  syncSuccess.value = '';
  clearTimeout(successTimeout);
  try {
    const result = await api('/cloud/sync-now', { method: 'POST' });
    if (!result.ok) {
      error.value = result.error || 'Erro na sincronização.';
    } else {
      const n = result.files_transferred || 0;
      syncSuccess.value = n > 0
        ? `✓ Sincronização concluída — ${n} arquivo(s) transferido(s)`
        : '✓ Sincronização concluída — tudo em dia';
      successTimeout = setTimeout(() => { syncSuccess.value = ''; }, 6000);
    }
    emit('sync-now');
  } catch (err) {
    error.value = err.message || 'Erro na sincronização.';
  } finally {
    syncing.value = false;
  }
}

async function saveConfig() {
  const remotePath = String(configForm.value.remote_path || '').trim();
  const interval = Number(configForm.value.sync_interval_minutes);
  error.value = '';
  configSuccess.value = '';
  clearTimeout(successTimeout);

  if (!remotePath) {
    error.value = 'Informe a pasta de destino no Google Drive.';
    return;
  }
  if (!Number.isFinite(interval) || interval < 1) {
    error.value = 'O intervalo precisa ser de pelo menos 1 minuto.';
    return;
  }

  savingConfig.value = true;
  try {
    await api('/cloud/config', {
      method: 'POST',
      body: JSON.stringify({
        remote_path: remotePath,
        sync_interval_minutes: Math.floor(interval)
      })
    });
    configSuccess.value = 'Configurações salvas.';
    successTimeout = setTimeout(() => { configSuccess.value = ''; }, 4000);
    emit('updated');
  } catch (err) {
    error.value = err.message || 'Erro ao salvar configurações.';
  } finally {
    savingConfig.value = false;
  }
}

function retry() {
  error.value = '';
  state.value = 'idle';
}

watch(
  () => [props.provider.remote_path, props.provider.sync_interval_minutes],
  () => {
    configForm.value = {
      remote_path: props.provider.remote_path || 'SaveSync/',
      sync_interval_minutes: props.provider.sync_interval_minutes || 5
    };
  }
);

watch(
  () => props.provider.connected,
  connected => {
    if (state.value !== 'pending') state.value = connected ? 'connected' : 'idle';
  }
);

onUnmounted(cleanup);
</script>

<template>
  <article class="cloud-provider-card">
    <!-- PENDING STATE — Waiting for browser auth -->
    <template v-if="state === 'pending'">
      <div class="pending-state">
        <span class="cloud-spinner" aria-hidden="true"></span>
        <div>
          <h2>Aguardando autorização no browser...</h2>
          <p>Uma aba foi aberta no seu navegador. Autorize o acesso ao Google Drive e volte aqui.</p>
        </div>
      </div>
      <button class="outline" @click="cancel">Cancelar</button>
    </template>

    <!-- CONNECTED STATE -->
    <template v-else-if="state === 'connected' || isConnected">
      <div class="cloud-card-header">
        <div class="cloud-provider-title">
          <span class="drive-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path class="drive-green" d="M8.7 4h6.6l6.2 10.8h-6.6z" />
              <path class="drive-yellow" d="M8.7 4 2.5 14.8 5.8 20 12 9.2z" />
              <path class="drive-blue" d="M5.8 20h12.4l3.3-5.2H9.1z" />
            </svg>
          </span>
          <div>
            <h2>{{ provider.name }}</h2>
            <p v-if="provider.account_email">{{ provider.account_email }}</p>
          </div>
        </div>
        <span class="badge badge-ok">● Conectado</span>
      </div>

      <div class="cloud-settings-grid">
        <label>
          <span>Pasta de destino</span>
          <input
            v-model.trim="configForm.remote_path"
            placeholder="SaveSync/"
            :disabled="savingConfig"
          />
        </label>
        <label>
          <span>Sync a cada</span>
          <input
            v-model.number="configForm.sync_interval_minutes"
            type="number"
            min="1"
            step="1"
            :disabled="savingConfig"
          />
        </label>
      </div>
      <p class="cloud-note">A pasta é criada dentro do Google Drive na próxima sincronização, se ainda não existir.</p>

      <div class="cloud-meta">
        <span>Última sync: {{ lastSync }} · {{ provider.files_synced || 0 }} arquivos</span>
        <span>Armazenamento: {{ storageUsed }}</span>
      </div>
      <p v-if="syncSuccess || configSuccess" class="cloud-success">{{ syncSuccess || configSuccess }}</p>
      <p v-else-if="visibleError" class="cloud-error">{{ visibleError }}</p>

      <div class="actions">
        <button class="outline" :disabled="savingConfig" @click="saveConfig">
          {{ savingConfig ? 'Salvando...' : 'Salvar configurações' }}
        </button>
        <button class="primary" :disabled="syncing" @click="syncNow">
          <span v-if="syncing" class="btn-spinner"></span>
          {{ syncing ? 'Sincronizando...' : 'Sincronizar agora' }}
        </button>
        <button class="danger-outline" @click="disconnect">Desconectar</button>
      </div>
    </template>

    <!-- ERROR STATE -->
    <template v-else-if="state === 'error'">
      <div class="cloud-card-header">
        <div class="cloud-provider-title">
          <span class="drive-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path class="drive-green" d="M8.7 4h6.6l6.2 10.8h-6.6z" />
              <path class="drive-yellow" d="M8.7 4 2.5 14.8 5.8 20 12 9.2z" />
              <path class="drive-blue" d="M5.8 20h12.4l3.3-5.2H9.1z" />
            </svg>
          </span>
          <div>
            <h2>{{ provider.name }}</h2>
            <p>Erro na conexão</p>
          </div>
        </div>
        <span class="badge badge-conflict">● Erro</span>
      </div>
      <p class="cloud-error">{{ error }}</p>
      <div class="actions">
        <button class="primary" @click="retry">Tentar novamente</button>
      </div>
    </template>

    <!-- IDLE STATE — Not connected -->
    <template v-else>
      <div class="cloud-card-header">
        <div class="cloud-provider-title">
          <span class="drive-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path class="drive-green" d="M8.7 4h6.6l6.2 10.8h-6.6z" />
              <path class="drive-yellow" d="M8.7 4 2.5 14.8 5.8 20 12 9.2z" />
              <path class="drive-blue" d="M5.8 20h12.4l3.3-5.2H9.1z" />
            </svg>
          </span>
          <div>
            <h2>{{ provider.name }}</h2>
            <p>Sincronize seus saves automaticamente</p>
          </div>
        </div>
      </div>

      <button class="primary connect-button" @click="connect">Conectar com Google Drive</button>
      <p class="cloud-note">Ao clicar, seu browser abrirá para autorização. Nenhuma senha é armazenada pelo SaveSync.</p>
      <p class="cloud-note">
        O SaveSync usa o cliente OAuth público do Rclone. Para uso pessoal, isso funciona sem configuração adicional.
        Se preferir usar suas próprias credenciais Google, consulte a documentação do Rclone.
      </p>
    </template>
  </article>
</template>

<style scoped>
.cloud-provider-card {
  display: grid;
  gap: 16px;
  width: min(620px, 100%);
  padding: 18px;
  background: #111318;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.cloud-card-header,
.cloud-provider-title,
.pending-state {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cloud-card-header {
  justify-content: space-between;
  flex-wrap: wrap;
}

.cloud-provider-title h2,
.pending-state h2 {
  margin: 0 0 4px;
  font-size: 15px;
}

.cloud-provider-title p,
.pending-state p,
.cloud-note,
.cloud-meta {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.drive-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: #161925;
  border: 1px solid var(--border);
}

.drive-icon svg {
  width: 24px;
  height: 24px;
}

.drive-green {
  fill: #16a34a;
}

.drive-yellow {
  fill: #f59e0b;
}

.drive-blue {
  fill: #38bdf8;
}

.connect-button {
  width: fit-content;
}

.cloud-spinner {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 3px solid rgba(167, 139, 250, 0.2);
  border-top-color: var(--accent-glow);
  border-radius: 999px;
  animation: cloud-spin 0.9s linear infinite;
}

.btn-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 999px;
  animation: cloud-spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 6px;
}

.cloud-settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 12px;
}

.cloud-settings-grid label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.cloud-meta {
  display: grid;
  gap: 5px;
}

.cloud-error {
  color: var(--red);
  font-size: 12px;
  line-height: 1.5;
}

.cloud-success {
  color: #22c55e;
  font-size: 12px;
  line-height: 1.5;
  animation: fade-in 0.3s ease;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

@keyframes cloud-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 680px) {
  .cloud-settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
