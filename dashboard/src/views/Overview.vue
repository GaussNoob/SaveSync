<script setup>
import { computed, onMounted, ref } from 'vue';
import { motion } from 'motion-v';
import {
  Activity,
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Gamepad2,
  HardDrive,
  RefreshCw,
  Server,
  ShieldAlert,
  Wifi,
  WifiOff
} from '@lucide/vue';
import { api } from '../api.js';
import { useRealtimeStore } from '../stores/realtime.js';
import { useUiStore } from '../stores/ui.js';
import { formatRelativeTime, platformLabel } from '../utils/formatters.js';
import EmptyState from '../components/EmptyState.vue';
import MetricCard from '../components/MetricCard.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import StatusBadge from '../components/StatusBadge.vue';

const emit = defineEmits(['open-add-game', 'changed']);
const MotionSection = motion.section;
const MotionDiv = motion.div;
const realtime = useRealtimeStore();
const ui = useUiStore();
const status = ref(null);
const conflicts = ref([]);
const cloud = ref(null);
const loading = ref(true);
const syncing = ref(false);
const error = ref('');

const games = computed(() => status.value?.games || []);
const monitored = computed(() => games.value.filter(game => game.enabled).length);
const pendingGames = computed(() => games.value.filter(game => !game.enabled).length);
const recentGames = computed(() => [...games.value]
  .sort((a, b) => String(b.last_save_at || '').localeCompare(String(a.last_save_at || '')))
  .slice(0, 8));
const liveLogs = computed(() => realtime.logs.slice(-6).reverse());
const syncSummary = computed(() => {
  if (realtime.syncState === 'syncing' || syncing.value) {
    return { label: 'Sincronizando', detail: realtime.syncMessage, tone: 'accent' };
  }
  if (realtime.syncState === 'error') {
    return { label: 'Com erro', detail: realtime.syncMessage, tone: 'danger' };
  }
  if (!status.value?.syncthing?.online) {
    return { label: 'Modo local', detail: 'Syncthing aguardando', tone: 'warning' };
  }
  return { label: 'Em dia', detail: 'Nenhuma ação pendente', tone: 'success' };
});
const engineRows = computed(() => [
  {
    label: 'API SaveSync',
    detail: status.value?.error ? 'Backend indisponível' : 'Respondendo normalmente',
    online: !status.value?.error,
    icon: Server
  },
  {
    label: 'Syncthing',
    detail: status.value?.syncthing?.online ? 'Pasta P2P conectada' : 'Aguardando conexão',
    online: Boolean(status.value?.syncthing?.online),
    icon: status.value?.syncthing?.online ? Wifi : WifiOff,
    warning: !status.value?.syncthing?.online
  },
  {
    label: 'Eventos em tempo real',
    detail: realtime.status === 'OPEN' ? 'WebSocket conectado' : 'Reconectando canal',
    online: realtime.status === 'OPEN',
    icon: Activity,
    warning: realtime.status !== 'OPEN'
  },
  {
    label: 'Google Drive',
    detail: cloud.value?.connected ? 'Rclone autenticado' : 'Backup externo desativado',
    online: Boolean(cloud.value?.connected),
    icon: cloud.value?.connected ? Cloud : CloudOff,
    warning: !cloud.value?.connected
  }
]);

async function load() {
  loading.value = true;
  error.value = '';
  const [statusPayload, conflictRows, cloudPayload] = await Promise.all([
    api('/status').catch(requestError => ({
      error: requestError.message,
      games: [],
      syncthing: { online: false }
    })),
    api('/conflicts').catch(() => []),
    api('/cloud/status').catch(() => ({ connected: false, last_sync: null }))
  ]);
  status.value = statusPayload;
  conflicts.value = conflictRows;
  cloud.value = cloudPayload;
  error.value = statusPayload.error || '';
  loading.value = false;
}

async function syncNow() {
  if (syncing.value) return;
  syncing.value = true;
  realtime.markSyncing('Criando snapshots locais');
  ui.notify({
    title: 'Sincronização iniciada',
    description: 'Os saves monitorados estão sendo arquivados.'
  });
  try {
    const result = await api('/status/sync', { method: 'POST', timeoutMs: 30 * 60_000 });
    const archived = result.local?.archived?.length || 0;
    realtime.markIdle('Sincronização concluída');
    ui.notify({
      title: 'Sincronização concluída',
      description: archived
        ? archived + ' fonte(s) atualizada(s).'
        : 'Nenhuma alteração nova foi encontrada.',
      tone: 'success'
    });
    emit('changed');
    await load();
  } catch (requestError) {
    realtime.markError(requestError.message);
    ui.notify({
      title: 'Falha ao sincronizar',
      description: requestError.message,
      tone: 'error'
    });
  } finally {
    syncing.value = false;
  }
}

function gameTone(game) {
  if (conflicts.value.some(conflict => conflict.game_id === game.id)) return 'danger';
  return game.enabled ? 'success' : 'warning';
}

function gameStatus(game) {
  if (conflicts.value.some(conflict => conflict.game_id === game.id)) return 'Conflito';
  return game.enabled ? 'Monitorado' : 'Pendente';
}

function formatLogTime(value) {
  if (!value) return '--:--:--';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value).slice(11, 19)
    : date.toLocaleTimeString('pt-BR', { hour12: false });
}

onMounted(load);
</script>

<template>
  <MotionSection
    class="view overview-view"
    :initial="{ opacity: 0, y: 3 }"
    :animate="{ opacity: 1, y: 0 }"
    :transition="{ duration: 0.18, ease: 'easeOut' }"
  >
    <template v-if="loading">
      <div class="overview-metrics">
        <article v-for="index in 4" :key="index" class="metric-card panel">
          <SkeletonBlock width="42%" height="10px" />
          <SkeletonBlock width="55%" height="24px" />
          <SkeletonBlock width="70%" height="10px" />
        </article>
      </div>
      <div class="overview-layout">
        <section class="panel skeleton-panel">
          <SkeletonBlock width="30%" height="11px" />
          <SkeletonBlock v-for="index in 6" :key="index" height="52px" />
        </section>
        <section class="panel skeleton-panel">
          <SkeletonBlock width="42%" height="11px" />
          <SkeletonBlock v-for="index in 4" :key="index" height="40px" />
        </section>
      </div>
    </template>

    <template v-else>
      <div v-if="error" class="inline-alert" data-tone="danger">
        <AlertTriangle :size="16" aria-hidden="true" />
        <div>
          <strong>Não foi possível alcançar o backend</strong>
          <span>{{ error }}</span>
        </div>
        <button class="button button-secondary" @click="load">Tentar novamente</button>
      </div>

      <MotionDiv
        v-if="conflicts.length"
        class="inline-alert"
        data-tone="danger"
        :initial="{ opacity: 0, y: -3 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.18, ease: 'easeOut' }"
      >
        <ShieldAlert :size="16" aria-hidden="true" />
        <div>
          <strong>{{ conflicts.length }} conflito(s) aguardando decisão</strong>
          <span>As versões divergentes permanecem isoladas em quarentena.</span>
        </div>
        <router-link class="button button-danger" to="/conflicts">Revisar conflitos</router-link>
      </MotionDiv>

      <div class="overview-toolbar">
        <div>
          <span class="section-label">Estado atual</span>
          <p v-if="monitored">{{ monitored }} de {{ games.length }} fonte(s) sob monitoramento</p>
          <p v-else>Ative o monitoramento de uma fonte para liberar a sincronização</p>
        </div>
        <button
          class="button button-primary"
          :disabled="syncing || !monitored"
          @click="syncNow"
        >
          <RefreshCw :size="15" :class="{ spinning: syncing }" />
          {{ syncing ? 'Sincronizando' : 'Sincronizar agora' }}
        </button>
      </div>

      <div class="overview-metrics">
        <MetricCard
          label="Sincronização"
          :value="syncSummary.label"
          :detail="syncSummary.detail"
          :icon="RefreshCw"
          :tone="syncSummary.tone"
        />
        <MetricCard
          label="Fontes detectadas"
          :value="games.length"
          :detail="pendingGames + ' pendente(s)'"
          :icon="Gamepad2"
        />
        <MetricCard
          label="Monitoradas"
          :value="monitored"
          detail="Backup local ativo"
          :icon="HardDrive"
          tone="accent"
        />
        <MetricCard
          label="Última nuvem"
          :value="cloud?.last_sync ? formatRelativeTime(cloud.last_sync) : 'Nunca'"
          :detail="cloud?.connected ? 'Google Drive conectado' : 'Nuvem não configurada'"
          :icon="cloud?.connected ? Cloud : CloudOff"
          :tone="cloud?.connected ? 'success' : 'neutral'"
        />
      </div>

      <div class="overview-layout">
        <section class="panel recent-panel">
          <header class="panel-header">
            <div>
              <h2 class="panel-title">Atividade recente</h2>
              <p class="panel-description">Fontes ordenadas pelo último save detectado</p>
            </div>
            <router-link class="button button-ghost" to="/history">Ver histórico</router-link>
          </header>

          <div v-if="recentGames.length" class="activity-table" aria-label="Atividade recente">
            <div class="activity-table-head" aria-hidden="true">
              <span>Jogo</span>
              <span>Origem</span>
              <span>Último evento</span>
              <span>Estado</span>
            </div>
            <router-link
              v-for="game in recentGames"
              :key="game.id"
              class="activity-row"
              to="/library"
            >
              <span class="activity-game">
                <span class="game-glyph">{{ String(game.name || 'S').slice(0, 1).toUpperCase() }}</span>
                <span>
                  <strong>{{ game.name }}</strong>
                  <code :title="game.source_path">{{ game.source_path }}</code>
                </span>
              </span>
              <span>{{ platformLabel(game.platform) }}</span>
              <span class="font-mono">{{ formatRelativeTime(game.last_save_at, 'Sem versão') }}</span>
              <StatusBadge :type="gameTone(game)">{{ gameStatus(game) }}</StatusBadge>
            </router-link>
          </div>

          <EmptyState
            v-else
            :icon="Gamepad2"
            title="Nenhum jogo detectado"
            description="Adicione uma fonte manualmente ou execute a varredura automática para começar."
          >
            <template #action>
              <button class="button button-primary" @click="emit('open-add-game')">Adicionar jogo</button>
            </template>
          </EmptyState>
        </section>

        <aside class="overview-aside">
          <section class="panel health-panel">
            <header class="panel-header">
              <div>
                <h2 class="panel-title">Saúde do sistema</h2>
                <p class="panel-description">Serviços necessários para o pipeline</p>
              </div>
            </header>
            <div class="health-list">
              <div v-for="engine in engineRows" :key="engine.label" class="health-row">
                <span
                  class="health-icon"
                  :data-tone="engine.online ? 'success' : engine.warning ? 'warning' : 'danger'"
                >
                  <component :is="engine.icon" :size="15" :stroke-width="1.6" />
                </span>
                <span>
                  <strong>{{ engine.label }}</strong>
                  <small>{{ engine.detail }}</small>
                </span>
                <StatusBadge :type="engine.online ? 'success' : engine.warning ? 'warning' : 'danger'">
                  {{ engine.online ? 'Online' : 'Pendente' }}
                </StatusBadge>
              </div>
            </div>
          </section>

          <section class="panel live-log-panel">
            <header class="panel-header">
              <div>
                <h2 class="panel-title">rclone ao vivo</h2>
                <p class="panel-description">Últimos eventos recebidos por WebSocket</p>
              </div>
              <span class="live-indicator" :data-online="realtime.status === 'OPEN'">
                <span></span>
                Live
              </span>
            </header>
            <div v-if="liveLogs.length" class="mini-log">
              <div v-for="(entry, index) in liveLogs" :key="entry.ts + '-' + index" :data-level="entry.level">
                <time>{{ formatLogTime(entry.ts) }}</time>
                <span>{{ entry.message }}</span>
              </div>
            </div>
            <EmptyState
              v-else
              compact
              :icon="Activity"
              title="Aguardando eventos"
              description="As mensagens do rclone aparecerão aqui durante a próxima sincronização."
            />
          </section>
        </aside>
      </div>
    </template>
  </MotionSection>
</template>
