<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import {
  Cloud,
  Download,
  ExternalLink,
  FolderSync,
  Link2,
  ShieldCheck,
  RefreshCw,
  Save,
  Unlink,
  XCircle
} from '@lucide/vue';
import { api } from '../api.js';
import { useRealtimeStore } from '../stores/realtime.js';
import { useUiStore } from '../stores/ui.js';
import { formatRelativeTime } from '../utils/formatters.js';
import ConfirmDialog from './ConfirmDialog.vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps({
  provider: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['connect', 'disconnect', 'sync-now', 'updated']);
const ui = useUiStore();
const realtime = useRealtimeStore();
const state = ref(props.provider.error ? 'error' : props.provider.connected ? 'connected' : 'idle');
const error = ref(props.provider.error || '');
const syncing = ref(false);
const savingConfig = ref(false);
const needsResync = ref(false);
const confirmation = ref({ open: false, type: '' });
const authUrl = ref('');
const openingExternal = ref(false);
const configForm = ref({
  remote_path: props.provider.remote_path || 'SaveSync/',
  sync_interval_minutes: props.provider.sync_interval_minutes || 5
});
let polling = null;
let pollCount = 0;
let pollGeneration = 0;
let pollInFlight = false;
const MAX_POLLS = 150;

const isConnected = computed(() => props.provider.connected);
const rcloneReady = computed(() => (
  props.provider.rclone_available !== false && props.provider.rclone_supported !== false
));
const rcloneRequirement = computed(() => {
  if (props.provider.rclone_available === false) {
    return {
      title: 'Rclone necessário para conectar',
      description: props.provider.rclone_platform === 'win32'
        ? 'Instale pelo winget ou abra o guia oficial. Depois, reinicie o SaveSync.'
        : 'Instale o rclone 1.71 ou mais recente e reinicie o SaveSync.'
    };
  }
  if (props.provider.rclone_supported === false) {
    return {
      title: 'Rclone precisa ser atualizado',
      description: `${props.provider.rclone_version || 'Versão atual'} — o SaveSync requer a versão 1.71 ou mais recente.`
    };
  }
  return null;
});
const rcloneInstallCommand = computed(() => (
  props.provider.rclone_platform === 'win32' ? 'winget install Rclone.Rclone' : ''
));
const visibleError = computed(() => error.value || props.provider.error || '');
const storageLabel = computed(() => {
  const used = props.provider.storage_used_label || 'Aguardando leitura';
  return props.provider.storage_total_label ? used + ' de ' + props.provider.storage_total_label : used;
});
const confirmationTitle = computed(() => (
  confirmation.value.type === 'disconnect'
    ? 'Desconectar Google Drive?'
    : 'Reconstruir o baseline?'
));
const confirmationDescription = computed(() => (
  confirmation.value.type === 'disconnect'
    ? 'O remote do rclone será removido e a sincronização em nuvem ficará desativada. Os arquivos já enviados não serão apagados.'
    : 'Use esta opção somente após conferir que os dados locais e remotos contêm as versões esperadas.'
));

function stopPolling() {
  if (polling) clearInterval(polling);
  polling = null;
  pollCount = 0;
  pollGeneration += 1;
}

async function pollAuthStatus(generation) {
  if (generation !== pollGeneration || pollInFlight) return;
  pollInFlight = true;
  pollCount += 1;
  if (pollCount > MAX_POLLS) {
    stopPolling();
    state.value = 'error';
    error.value = 'Tempo limite excedido. Tente novamente.';
    pollInFlight = false;
    return;
  }
  try {
    const payload = await api('/cloud/auth/google-drive/status');
    if (generation !== pollGeneration) return;
    if (payload.auth_url) authUrl.value = payload.auth_url;
    if (payload.status === 'success') {
      stopPolling();
      state.value = 'connected';
      error.value = '';
      authUrl.value = '';
      ui.notify({
        title: 'Google Drive conectado',
        description: 'O remote do rclone está pronto para sincronizar.',
        tone: 'success'
      });
      emit('connect');
    } else if (payload.status === 'error') {
      stopPolling();
      state.value = 'error';
      error.value = payload.error || 'Não foi possível conectar ao Google Drive.';
    } else if (payload.status === 'idle' && state.value === 'pending') {
      stopPolling();
      state.value = 'idle';
    }
  } catch {
    // A queda pode ser transitória durante o OAuth; o próximo polling tenta novamente.
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  stopPolling();
  const generation = pollGeneration;
  void pollAuthStatus(generation);
  polling = setInterval(() => void pollAuthStatus(generation), 2000);
}

async function connect() {
  if (!rcloneReady.value) {
    ui.notify({
      title: rcloneRequirement.value?.title || 'Rclone indisponível',
      description: rcloneRequirement.value?.description || 'Confira a instalação antes de continuar.',
      tone: 'warning'
    });
    return;
  }
  state.value = 'pending';
  error.value = '';
  authUrl.value = '';
  ui.notify({
    title: 'Autorização iniciada',
    description: 'Conclua o acesso ao Google Drive no navegador.'
  });
  try {
    const result = await api('/cloud/auth/google-drive/start', {
      method: 'POST',
      timeoutMs: 90_000
    });
    if (result.status === 'already_connected') {
      state.value = 'connected';
      emit('connect');
      return;
    }
    if (result.auth_url) {
      authUrl.value = result.auth_url;
      await openAuthPage();
    }
    startPolling();
  } catch (requestError) {
    state.value = 'error';
    error.value = requestError.message || 'Erro ao iniciar autorização.';
    ui.notify({
      title: 'Não foi possível abrir o Google Drive',
      description: error.value,
      tone: 'error'
    });
  }
}

function normalizeExternalUrl(value, { oauth = false } = {}) {
  try {
    const url = new URL(String(value || ''));
    if (oauth) {
      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
      return url.protocol === 'http:' && loopback && url.pathname.startsWith('/auth') ? url.href : null;
    }
    return url.protocol === 'https:' && (url.hostname === 'rclone.org' || url.hostname.endsWith('.rclone.org'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

async function openExternalUrl(value, options = {}) {
  const target = normalizeExternalUrl(value, options);
  if (!target || openingExternal.value) return false;
  openingExternal.value = true;
  try {
    if (window.saveSync?.openExternal) {
      await window.saveSync.openExternal(target);
    } else {
      const link = document.createElement('a');
      link.href = target;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.append(link);
      link.click();
      link.remove();
    }
    return true;
  } catch (openError) {
    error.value = openError.message || 'Não foi possível abrir o navegador.';
    return false;
  } finally {
    openingExternal.value = false;
  }
}

async function openAuthPage() {
  await openExternalUrl(authUrl.value, { oauth: true });
}

async function openInstallGuide() {
  await openExternalUrl(props.provider.rclone_install_url || 'https://rclone.org/downloads/');
}

async function cancel() {
  stopPolling();
  try {
    await api('/cloud/auth/google-drive', { method: 'DELETE', timeoutMs: 90_000 });
  } catch {
    // O estado local ainda deve sair do modo pendente.
  }
  state.value = 'idle';
  error.value = '';
  authUrl.value = '';
}

function requestConfirmation(type) {
  confirmation.value = { open: true, type };
}

async function confirmAction() {
  const type = confirmation.value.type;
  confirmation.value.open = false;
  if (type === 'disconnect') await disconnect();
  else await syncNow(true);
}

async function disconnect() {
  const previousState = state.value;
  state.value = 'idle';
  error.value = '';
  try {
    await api('/cloud/auth/google-drive', { method: 'DELETE', timeoutMs: 90_000 });
    ui.notify({
      title: 'Google Drive desconectado',
      description: 'A sincronização em nuvem foi desativada.',
      tone: 'success'
    });
    emit('disconnect');
  } catch (requestError) {
    state.value = previousState;
    error.value = requestError.message || 'Erro ao desconectar.';
    ui.notify({
      title: 'Não foi possível desconectar',
      description: error.value,
      tone: 'error'
    });
  }
}

async function syncNow(resyncRequested = false) {
  if (syncing.value || savingConfig.value) return;
  const resync = resyncRequested === true;
  syncing.value = true;
  error.value = '';
  needsResync.value = false;
  try {
    await persistCloudConfig();
    realtime.markSyncing(resync ? 'Reconstruindo baseline do bisync' : 'Sincronizando Google Drive');
    ui.notify({
      title: resync ? 'Reconstrução iniciada' : 'Sincronização iniciada',
      description: 'O rclone está processando as versões locais e remotas.'
    });
    const result = await api('/cloud/sync-now', {
      method: 'POST',
      body: JSON.stringify(resync ? { resync: true, confirm_resync: true } : {}),
      timeoutMs: 31 * 60_000
    });
    const transferred = result.files_transferred || 0;
    realtime.markIdle('Sincronização em nuvem concluída');
    ui.notify({
      title: 'Nuvem sincronizada',
      description: transferred
        ? transferred + ' arquivo(s) transferido(s).'
        : 'As duas pontas já estavam em dia.',
      tone: 'success'
    });
    emit('sync-now');
  } catch (requestError) {
    error.value = requestError.message || 'Erro na sincronização.';
    needsResync.value = Boolean(requestError.payload?.needs_resync);
    realtime.markError(error.value);
    ui.notify({
      title: 'Falha na sincronização',
      description: error.value,
      tone: 'error'
    });
  } finally {
    syncing.value = false;
  }
}

async function saveConfig() {
  if (savingConfig.value || syncing.value) return;
  savingConfig.value = true;
  error.value = '';
  try {
    await persistCloudConfig();
    ui.notify({
      title: 'Configuração de nuvem salva',
      description: 'A sincronização em nuvem está ativa com os novos parâmetros.',
      tone: 'success'
    });
    emit('updated');
  } catch (requestError) {
    error.value = requestError.message || 'Erro ao salvar configurações.';
    ui.notify({
      title: 'Não foi possível salvar',
      description: error.value,
      tone: 'error'
    });
  } finally {
    savingConfig.value = false;
  }
}

async function persistCloudConfig() {
  const config = normalizedCloudConfig();
  await api('/cloud/config', {
    method: 'POST',
    body: JSON.stringify({
      enabled: true,
      ...config
    })
  });
}

function normalizedCloudConfig() {
  const remotePath = String(configForm.value.remote_path || '').trim();
  const interval = Number(configForm.value.sync_interval_minutes);
  if (!remotePath) {
    throw new Error('Informe a pasta de destino no Google Drive.');
  }
  if (!Number.isFinite(interval) || interval < 1 || interval > 1440) {
    throw new Error('O intervalo precisa ficar entre 1 e 1440 minutos.');
  }
  return {
    remote_path: remotePath,
    sync_interval_minutes: Math.floor(interval)
  };
}

function retry() {
  error.value = '';
  state.value = 'idle';
  authUrl.value = '';
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
  () => [props.provider.connected, props.provider.error],
  ([connected, providerError]) => {
    if (state.value !== 'pending') {
      state.value = providerError ? 'error' : connected ? 'connected' : 'idle';
      if (providerError) error.value = providerError;
    }
  }
);

onUnmounted(stopPolling);
</script>

<template>
  <article class="panel cloud-provider-card">
    <template v-if="state === 'pending'">
      <div class="provider-pending">
        <span class="provider-icon provider-icon-active"><Link2 :size="18" /></span>
        <div>
          <h2>Autorização em andamento</h2>
          <p>O rclone está aguardando a confirmação da sua conta Google.</p>
        </div>
        <StatusBadge type="accent">Aguardando</StatusBadge>
      </div>

      <div class="provider-auth-steps" aria-label="Progresso da autorização">
        <span data-state="complete">1</span>
        <i></i>
        <span data-state="active">2</span>
        <i></i>
        <span>3</span>
        <small>Iniciado</small>
        <small>Autorizar</small>
        <small>Conectado</small>
      </div>

      <div v-if="authUrl" class="provider-auth-link">
        <ShieldCheck :size="18" />
        <div>
          <strong>Link de autenticação pronto</strong>
          <span>Se o navegador não abriu sozinho, continue pelo botão ao lado.</span>
        </div>
        <button class="button button-primary" :disabled="openingExternal" @click="openAuthPage">
          <ExternalLink :size="14" />
          Abrir login do Google
        </button>
      </div>
      <div v-else class="provider-auth-wait">
        <RefreshCw :size="14" class="spinning" />
        Preparando o login seguro no navegador…
      </div>

      <div class="provider-actions">
        <button class="button button-ghost" @click="cancel">Cancelar autorização</button>
      </div>
    </template>

    <template v-else-if="state === 'connected' || isConnected">
      <header class="provider-header">
        <div class="provider-title">
          <span class="provider-icon provider-icon-success"><ShieldCheck :size="18" /></span>
          <div>
            <h2>{{ provider.name }}</h2>
            <p>{{ provider.account_email || provider.remote_name || 'savesync-gdrive' }}</p>
          </div>
        </div>
        <StatusBadge type="success">Conectado</StatusBadge>
      </header>

      <div class="provider-stats">
        <div>
          <span>Última sync</span>
          <strong>{{ formatRelativeTime(provider.last_sync) }}</strong>
        </div>
        <div>
          <span>Arquivos</span>
          <strong>{{ provider.files_synced || 0 }}</strong>
        </div>
        <div>
          <span>Armazenamento</span>
          <strong>{{ storageLabel }}</strong>
        </div>
      </div>

      <div class="provider-form">
        <label class="settings-field">
          <span>Pasta remota</span>
          <input
            v-model.trim="configForm.remote_path"
            placeholder="SaveSync/"
            :disabled="savingConfig"
          />
          <small>Criada dentro do Google Drive no próximo ciclo, se necessário.</small>
        </label>
        <label class="settings-field provider-interval">
          <span>Intervalo</span>
          <div class="input-suffix">
            <input
              v-model.number="configForm.sync_interval_minutes"
              type="number"
              min="1"
              max="1440"
              step="1"
              :disabled="savingConfig"
            />
            <span>min</span>
          </div>
        </label>
      </div>

      <div v-if="visibleError" class="provider-error">
        <XCircle :size="15" />
        <span>{{ visibleError }}</span>
      </div>

      <div v-if="needsResync" class="provider-resync">
        <div>
          <strong>Baseline do bisync ausente</strong>
          <span>Confira as duas pontas antes de reconstruir o estado base.</span>
        </div>
        <button class="button button-danger" @click="requestConfirmation('resync')">
          Reconstruir baseline
        </button>
      </div>

      <div class="provider-actions">
        <button class="button button-secondary" :disabled="savingConfig || syncing" @click="saveConfig">
          <Save :size="14" />
          {{ savingConfig ? 'Salvando…' : 'Salvar' }}
        </button>
        <button class="button button-primary" :disabled="syncing || savingConfig" @click="syncNow(false)">
          <RefreshCw :size="14" :class="{ spinning: syncing }" />
          {{ syncing ? 'Sincronizando' : 'Sincronizar agora' }}
        </button>
        <button class="button button-ghost provider-disconnect" @click="requestConfirmation('disconnect')">
          <Unlink :size="14" />
          Desconectar
        </button>
      </div>
    </template>

    <template v-else-if="state === 'error'">
      <div class="provider-pending">
        <span class="provider-icon"><XCircle :size="17" /></span>
        <div>
          <h2>Falha na conexão</h2>
          <p>{{ error }}</p>
        </div>
        <StatusBadge type="danger">Erro</StatusBadge>
      </div>
      <div class="provider-actions">
        <button class="button button-primary" @click="retry">Tentar novamente</button>
      </div>
    </template>

    <template v-else>
      <header class="provider-header">
        <div class="provider-title">
          <span class="provider-icon provider-icon-drive"><Cloud :size="18" /></span>
          <div>
            <h2>{{ provider.name }}</h2>
            <p>Backup seguro e bidirecional dos seus saves</p>
          </div>
        </div>
        <StatusBadge :type="rcloneReady ? 'neutral' : 'warning'">
          {{ rcloneReady ? 'Desconectado' : 'Configuração necessária' }}
        </StatusBadge>
      </header>

      <div class="provider-idle-benefits">
        <div class="provider-idle-copy">
          <FolderSync :size="17" />
          <p>
            <strong>Versões sempre disponíveis</strong>
            <span>Mantenha os snapshots locais e do Drive em sincronia.</span>
          </p>
        </div>
        <div class="provider-idle-copy">
          <ShieldCheck :size="17" />
          <p>
            <strong>Acesso protegido</strong>
            <span>O token fica salvo apenas no arquivo local do rclone.</span>
          </p>
        </div>
      </div>

      <div v-if="rcloneRequirement" class="provider-requirement">
        <Download :size="18" />
        <div>
          <strong>{{ rcloneRequirement.title }}</strong>
          <span>{{ rcloneRequirement.description }}</span>
          <code v-if="rcloneInstallCommand">{{ rcloneInstallCommand }}</code>
        </div>
        <button class="button button-secondary" :disabled="openingExternal" @click="openInstallGuide">
          <ExternalLink :size="14" />
          Guia de instalação
        </button>
      </div>

      <div class="provider-actions">
        <button class="button button-primary provider-connect-button" :disabled="!rcloneReady" @click="connect">
          <Link2 :size="14" />
          Conectar Google Drive
        </button>
        <span v-if="provider.rclone_version" class="provider-runtime">
          rclone {{ provider.rclone_version.replace(/^rclone\s+v?/i, '') }}
        </span>
      </div>
    </template>

    <ConfirmDialog
      :open="confirmation.open"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :confirm-label="confirmation.type === 'disconnect' ? 'Desconectar' : 'Reconstruir'"
      :tone="confirmation.type === 'disconnect' ? 'danger' : 'accent'"
      @update:open="confirmation.open = $event"
      @confirm="confirmAction"
    />
  </article>
</template>
