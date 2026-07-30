<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  Archive,
  Cloud,
  Gamepad2,
  HardDrive,
  Plus,
  RefreshCw,
  RotateCcw,
  TriangleAlert
} from '@lucide/vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import { api } from '../api.js';
import { useUiStore } from '../stores/ui.js';
import { formatBytes, formatDateTime, formatRelativeTime, platformLabel } from '../utils/formatters.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import StatusBadge from '../components/StatusBadge.vue';

const emit = defineEmits(['changed', 'open-add-game']);
const ui = useUiStore();
const games = ref([]);
const selected = ref('');
const events = ref([]);
const gamesLoading = ref(true);
const eventsLoading = ref(false);
const error = ref('');
const eventFilter = ref('all');
const restoring = ref(false);
const creatingSnapshot = ref(false);
const optimisticRestoredId = ref(null);
const confirmation = ref({ open: false, event: null });

const selectedGame = computed(() => games.value.find(game => game.id === selected.value));
const filteredEvents = computed(() => {
  if (eventFilter.value === 'all') return events.value;
  return events.value.filter(event => eventSource(event) === eventFilter.value);
});
const versionLabels = computed(() => new Map(
  events.value.map((event, index) => [
    event.id,
    'V' + String(events.value.length - index).padStart(3, '0')
  ])
));
const localCount = computed(() => events.value.filter(event => eventSource(event) === 'local').length);
const remoteCount = computed(() => events.value.filter(event => eventSource(event) === 'remote').length);
const confirmationDescription = computed(() => {
  const event = confirmation.value.event;
  if (!event) return '';
  return '“' + (selectedGame.value?.name || 'Este save') + '” voltará para ' +
    formatDateTime(event.created_at) + '. Uma versão de segurança será criada antes.';
});

async function loadGames() {
  gamesLoading.value = true;
  error.value = '';
  try {
    games.value = await api('/games');
    if (!games.value.some(game => game.id === selected.value)) {
      selected.value = games.value[0]?.id || '';
    }
    if (!selected.value) events.value = [];
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    gamesLoading.value = false;
  }
}

async function loadEvents() {
  const gameId = selected.value;
  eventsLoading.value = true;
  error.value = '';
  try {
    const payload = gameId ? await api('/saves/' + gameId) : [];
    if (selected.value === gameId) events.value = payload;
  } catch (requestError) {
    events.value = [];
    error.value = requestError.message;
  } finally {
    eventsLoading.value = false;
  }
}

function requestRestore(event) {
  confirmation.value = { open: true, event };
}

async function confirmRestore() {
  const event = confirmation.value.event;
  if (!event || restoring.value) return;
  confirmation.value.open = false;
  restoring.value = true;
  optimisticRestoredId.value = event.id;
  ui.notify({
    title: 'Restauração iniciada',
    description: versionLabels.value.get(event.id) + ' está sendo aplicada a ' + selectedGame.value?.name + '.'
  });
  try {
    await api('/saves/' + selected.value + '/restore', {
      method: 'POST',
      body: JSON.stringify({ event_id: event.id }),
      timeoutMs: 30 * 60_000
    });
    ui.notify({
      title: 'Versão restaurada',
      description: 'Uma cópia de segurança do estado anterior foi criada.',
      tone: 'success'
    });
    await loadEvents();
    optimisticRestoredId.value = null;
    emit('changed');
  } catch (requestError) {
    optimisticRestoredId.value = null;
    ui.notify({
      title: 'A restauração não foi aplicada',
      description: requestError.message,
      tone: 'error'
    });
  } finally {
    restoring.value = false;
    optimisticRestoredId.value = null;
    confirmation.value = { open: false, event: null };
  }
}

async function createSnapshot() {
  if (creatingSnapshot.value) return;
  creatingSnapshot.value = true;
  ui.notify({
    title: 'Criando snapshot',
    description: 'As fontes monitoradas estão sendo arquivadas.'
  });
  try {
    const result = await api('/status/local-sync', { method: 'POST', timeoutMs: 30 * 60_000 });
    const archived = result.local?.archived?.length || 0;
    ui.notify({
      title: 'Snapshot criado',
      description: archived + ' fonte(s) arquivada(s).',
      tone: 'success'
    });
    await loadEvents();
    emit('changed');
  } catch (requestError) {
    ui.notify({
      title: 'Não foi possível criar o snapshot',
      description: requestError.message,
      tone: 'error'
    });
  } finally {
    creatingSnapshot.value = false;
  }
}

function eventSource(event) {
  return event.event_type === 'remote' ? 'remote' : 'local';
}

watch(selected, () => {
  eventFilter.value = 'all';
  void loadEvents();
});
onMounted(loadGames);
</script>

<template>
  <section class="view history-view">
    <div v-if="error" class="inline-alert" data-tone="danger">
      <TriangleAlert :size="16" />
      <div>
        <strong>Não foi possível carregar o histórico</strong>
        <span>{{ error }}</span>
      </div>
      <button class="button button-secondary" @click="selected ? loadEvents() : loadGames()">Tentar novamente</button>
    </div>

    <div v-if="gamesLoading" class="history-layout">
      <aside class="panel history-sources skeleton-panel">
        <SkeletonBlock width="38%" height="11px" />
        <SkeletonBlock v-for="index in 7" :key="index" height="48px" />
      </aside>
      <section class="panel history-archive skeleton-panel">
        <SkeletonBlock width="28%" height="12px" />
        <SkeletonBlock v-for="index in 8" :key="index" height="56px" />
      </section>
    </div>

    <section v-else-if="!games.length" class="panel">
      <EmptyState
        :icon="Gamepad2"
        title="Nenhuma fonte disponível"
        description="Adicione um jogo antes de criar ou restaurar versões."
      >
        <template #action>
          <button class="button button-primary" @click="emit('open-add-game')">
            <Plus :size="15" />
            Adicionar jogo
          </button>
        </template>
      </EmptyState>
    </section>

    <div v-else class="history-layout">
      <aside class="panel history-sources">
        <header class="panel-header">
          <div>
            <h2 class="panel-title">Fontes</h2>
            <p class="panel-description">{{ games.length }} jogo(s) configurado(s)</p>
          </div>
        </header>
        <div class="history-game-list">
          <button
            v-for="game in games"
            :key="game.id"
            :class="{ active: selected === game.id }"
            @click="selected = game.id"
          >
            <span class="game-glyph">{{ String(game.name || 'S').slice(0, 1).toUpperCase() }}</span>
            <span>
              <strong>{{ game.name }}</strong>
              <small>{{ platformLabel(game.platform) }} · {{ formatRelativeTime(game.last_save_at, 'Sem versão') }}</small>
            </span>
          </button>
        </div>
      </aside>

      <section class="panel history-archive">
        <header class="history-archive-header">
          <div class="history-archive-title">
            <span class="history-archive-icon"><Archive :size="16" /></span>
            <div>
              <h2>{{ selectedGame?.name }}</h2>
              <p>{{ events.length }} versão(ões) arquivada(s)</p>
            </div>
          </div>
          <div class="history-actions">
            <div class="history-filters" aria-label="Filtrar origem">
              <button :class="{ active: eventFilter === 'all' }" @click="eventFilter = 'all'">
                Todas <span>{{ events.length }}</span>
              </button>
              <button :class="{ active: eventFilter === 'local' }" @click="eventFilter = 'local'">
                Local <span>{{ localCount }}</span>
              </button>
              <button :class="{ active: eventFilter === 'remote' }" @click="eventFilter = 'remote'">
                Remoto <span>{{ remoteCount }}</span>
              </button>
            </div>
            <button class="button button-secondary" :disabled="creatingSnapshot" @click="createSnapshot">
              <Plus :size="14" />
              {{ creatingSnapshot ? 'Criando…' : 'Criar snapshot' }}
            </button>
          </div>
        </header>

        <div class="history-table-head">
          <span>Versão</span>
          <span>Data / arquivo</span>
          <span>Origem</span>
          <span>Tamanho</span>
          <span aria-hidden="true"></span>
        </div>

        <div v-if="eventsLoading" class="history-events-skeleton">
          <div v-for="index in 8" :key="index">
            <SkeletonBlock width="48px" height="24px" />
            <span>
              <SkeletonBlock width="130px" height="10px" />
              <SkeletonBlock width="78%" height="9px" />
            </span>
            <SkeletonBlock width="56px" height="22px" />
            <SkeletonBlock width="48px" height="10px" />
            <SkeletonBlock width="72px" height="30px" />
          </div>
        </div>

        <DynamicScroller
          v-else-if="filteredEvents.length"
          :items="filteredEvents"
          :min-item-size="62"
          key-field="id"
          class="history-scroller"
        >
          <template #default="{ item: event, index, active }">
            <DynamicScrollerItem
              :item="event"
              :active="active"
              :data-index="index"
              :size-dependencies="[event.archive_path, optimisticRestoredId === event.id]"
            >
              <article class="history-row" :data-restoring="optimisticRestoredId === event.id">
                <span class="version-chip">{{ versionLabels.get(event.id) }}</span>
                <div class="history-event-main">
                  <strong>{{ formatDateTime(event.created_at) }}</strong>
                  <code :title="event.archive_path">{{ event.archive_path }}</code>
                </div>
                <StatusBadge :type="eventSource(event) === 'remote' ? 'accent' : 'neutral'">
                  <Cloud v-if="eventSource(event) === 'remote'" :size="11" />
                  <HardDrive v-else :size="11" />
                  {{ eventSource(event) === 'remote' ? 'Remoto' : 'Local' }}
                </StatusBadge>
                <span class="history-size font-mono">{{ formatBytes(event.size) }}</span>
                <button
                  class="button button-secondary history-restore"
                  :disabled="restoring"
                  @click="requestRestore(event)"
                >
                  <RefreshCw
                    v-if="optimisticRestoredId === event.id"
                    :size="13"
                    class="spinning"
                  />
                  <RotateCcw v-else :size="13" />
                  {{ optimisticRestoredId === event.id ? 'Aplicando' : 'Restaurar' }}
                </button>
              </article>
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>

        <EmptyState
          v-else-if="events.length"
          compact
          :icon="Archive"
          title="Nenhuma versão neste filtro"
          description="Selecione outra origem para visualizar os snapshots disponíveis."
        >
          <template #action>
            <button class="button button-secondary" @click="eventFilter = 'all'">Mostrar todas</button>
          </template>
        </EmptyState>

        <EmptyState
          v-else
          :icon="Archive"
          title="Nenhuma versão arquivada"
          description="Crie o primeiro snapshot das fontes monitoradas para habilitar restaurações."
        >
          <template #action>
            <button class="button button-primary" :disabled="creatingSnapshot" @click="createSnapshot">
              <Plus :size="14" />
              Criar snapshot
            </button>
          </template>
        </EmptyState>
      </section>
    </div>

    <ConfirmDialog
      :open="confirmation.open"
      title="Restaurar esta versão?"
      :description="confirmationDescription"
      confirm-label="Restaurar versão"
      tone="accent"
      :busy="restoring"
      @update:open="confirmation.open = $event"
      @confirm="confirmRestore"
    />
  </section>
</template>
