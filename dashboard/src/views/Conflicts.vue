<script setup>
import { computed, onMounted, ref } from 'vue';
import { motion } from 'motion-v';
import {
  ArchiveRestore,
  Check,
  File,
  FolderLock,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  TriangleAlert
} from '@lucide/vue';
import { api } from '../api.js';
import { useUiStore } from '../stores/ui.js';
import { formatBytes, formatDateTime } from '../utils/formatters.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import StatusBadge from '../components/StatusBadge.vue';

const emit = defineEmits(['changed']);
const ui = useUiStore();
const MotionArticle = motion.article;
const conflicts = ref([]);
const games = ref([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref('');
const confirmation = ref({ open: false, conflict: null, resolution: '' });
const resolving = ref(false);

const gameNames = computed(() => new Map(games.value.map(game => [game.id, game.name])));
const confirmationTitle = computed(() => (
  confirmation.value.resolution === 'use-local'
    ? 'Manter a versão local?'
    : 'Aplicar a versão em quarentena?'
));
const confirmationDescription = computed(() => {
  const conflict = confirmation.value.conflict;
  if (!conflict) return '';
  if (confirmation.value.resolution === 'use-local') {
    return 'A versão atual de ' + gameName(conflict) + ' será mantida e o conflito será encerrado.';
  }
  return 'A versão em quarentena substituirá o arquivo atual. Uma cópia de segurança local será criada antes.';
});

async function load({ silent = false } = {}) {
  if (silent) refreshing.value = true;
  else loading.value = true;
  error.value = '';
  const [conflictResult, gameResult] = await Promise.allSettled([
    api('/conflicts'),
    api('/games')
  ]);
  if (conflictResult.status === 'fulfilled') conflicts.value = conflictResult.value;
  else error.value = conflictResult.reason.message;
  if (gameResult.status === 'fulfilled') games.value = gameResult.value;
  loading.value = false;
  refreshing.value = false;
}

function requestResolve(conflict, resolution) {
  confirmation.value = { open: true, conflict, resolution };
}

async function confirmResolve() {
  const { conflict, resolution } = confirmation.value;
  if (!conflict || resolving.value) return;
  resolving.value = true;
  confirmation.value.open = false;
  const index = conflicts.value.findIndex(item => item.id === conflict.id);
  if (index >= 0) conflicts.value.splice(index, 1);
  ui.notify({
    title: 'Aplicando resolução',
    description: gameName(conflict) + ' foi removido da fila.',
    tone: 'info'
  });
  try {
    await api('/conflicts/' + conflict.id + '/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolution })
    });
    ui.notify({
      title: 'Conflito resolvido',
      description: resolution === 'use-local'
        ? 'A versão local foi mantida.'
        : 'A versão em quarentena foi aplicada.',
      tone: 'success'
    });
    emit('changed');
  } catch (requestError) {
    if (index >= 0) conflicts.value.splice(index, 0, conflict);
    ui.notify({
      title: 'A resolução não foi aplicada',
      description: requestError.message,
      tone: 'error'
    });
  } finally {
    resolving.value = false;
    confirmation.value = { open: false, conflict: null, resolution: '' };
  }
}

function gameName(conflict) {
  return gameNames.value.get(conflict.game_id) || conflict.game_id || 'Jogo não identificado';
}

function fileName(path) {
  return String(path || '').split(/[\\/]/).filter(Boolean).at(-1) || 'save';
}

onMounted(load);
</script>

<template>
  <section class="view conflicts-view">
    <div class="conflicts-toolbar panel">
      <div>
        <span class="section-label">Fila de resolução</span>
        <p>
          <strong>{{ conflicts.length }}</strong>
          conflito(s) aberto(s)
        </p>
      </div>
      <button class="button button-secondary" :disabled="refreshing" @click="load({ silent: true })">
        <RefreshCw :size="14" :class="{ spinning: refreshing }" />
        Atualizar
      </button>
    </div>

    <div v-if="error" class="inline-alert" data-tone="danger">
      <TriangleAlert :size="16" />
      <div>
        <strong>Não foi possível carregar os conflitos</strong>
        <span>{{ error }}</span>
      </div>
      <button class="button button-secondary" @click="load()">Tentar novamente</button>
    </div>

    <template v-if="loading">
      <section v-for="index in 3" :key="index" class="panel conflict-skeleton">
        <div class="panel-header">
          <SkeletonBlock width="190px" height="11px" />
          <SkeletonBlock width="68px" height="22px" />
        </div>
        <div class="conflict-compare">
          <div v-for="side in 2" :key="side" class="conflict-version">
            <SkeletonBlock width="42%" height="11px" />
            <SkeletonBlock width="74%" height="10px" />
            <SkeletonBlock width="100%" height="46px" />
            <SkeletonBlock width="118px" height="30px" />
          </div>
        </div>
      </section>
    </template>

    <template v-else-if="conflicts.length">
      <MotionArticle
        v-for="(conflict, index) in conflicts"
        :key="conflict.id"
        class="panel conflict-card"
        :initial="{ opacity: 0, y: 4 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ duration: 0.18, delay: Math.min(index * 0.025, 0.15), ease: 'easeOut' }"
      >
        <header class="panel-header conflict-card-header">
          <div class="conflict-game">
            <span class="conflict-file-icon">
              <File :size="15" :stroke-width="1.6" />
            </span>
            <div>
              <h2 class="panel-title">{{ gameName(conflict) }}</h2>
              <p class="panel-description">
                {{ fileName(conflict.original_path) }} · detectado em
                <span class="font-mono">{{ formatDateTime(conflict.created_at) }}</span>
              </p>
            </div>
          </div>
          <StatusBadge type="danger">Conflito aberto</StatusBadge>
        </header>

        <div class="conflict-compare">
          <section class="conflict-version">
            <header>
              <span class="conflict-source-icon"><HardDrive :size="15" /></span>
              <div>
                <strong>Versão local</strong>
                <small>Arquivo atualmente em uso</small>
              </div>
            </header>
            <dl>
              <div>
                <dt>Dispositivo</dt>
                <dd>Este dispositivo</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd class="font-mono">{{ formatDateTime(conflict.created_at) }}</dd>
              </div>
              <div>
                <dt>Tamanho</dt>
                <dd>Arquivo atual</dd>
              </div>
            </dl>
            <div class="conflict-path">
              <span>Caminho original</span>
              <code>{{ conflict.original_path }}</code>
            </div>
            <button
              class="button button-secondary conflict-choice"
              @click="requestResolve(conflict, 'use-local')"
            >
              <Check :size="14" />
              Manter local
            </button>
          </section>

          <div class="conflict-divider" aria-hidden="true"><span>ou</span></div>

          <section class="conflict-version">
            <header>
              <span class="conflict-source-icon"><FolderLock :size="15" /></span>
              <div>
                <strong>Versão em quarentena</strong>
                <small>Cópia divergente isolada</small>
              </div>
            </header>
            <dl>
              <div>
                <dt>Origem</dt>
                <dd>Dispositivo remoto</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd class="font-mono">{{ formatDateTime(conflict.metadata?.mtime || conflict.created_at) }}</dd>
              </div>
              <div>
                <dt>Tamanho</dt>
                <dd>{{ formatBytes(conflict.metadata?.size) }}</dd>
              </div>
            </dl>
            <div class="conflict-path">
              <span>Caminho em quarentena</span>
              <code>{{ conflict.quarantine_path }}</code>
            </div>
            <button
              class="button button-primary conflict-choice"
              @click="requestResolve(conflict, 'use-quarantine')"
            >
              <ArchiveRestore :size="14" />
              Usar quarentena
            </button>
          </section>
        </div>
      </MotionArticle>
    </template>

    <section v-else class="panel">
      <EmptyState
        :icon="ShieldCheck"
        title="Nenhum conflito aberto"
        description="Não há versões divergentes aguardando decisão. A fila será atualizada quando um novo conflito for detectado."
      >
        <template #action>
          <button class="button button-secondary" @click="load({ silent: true })">
            <RefreshCw :size="14" />
            Atualizar fila
          </button>
        </template>
      </EmptyState>
    </section>

    <ConfirmDialog
      :open="confirmation.open"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :confirm-label="confirmation.resolution === 'use-local' ? 'Manter local' : 'Usar quarentena'"
      tone="accent"
      :busy="resolving"
      @update:open="confirmation.open = $event"
      @confirm="confirmResolve"
    />
  </section>
</template>
