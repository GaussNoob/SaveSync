<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';

const status = ref(null);
const conflicts = ref([]);
const cloud = ref(null);
const loading = ref(true);

async function load() {
  loading.value = true;
  const [statusPayload, conflictRows, cloudPayload] = await Promise.all([
    api('/status').catch(error => ({ error: error.message, games: [], syncthing: { online: false } })),
    api('/conflicts').catch(() => []),
    api('/cloud/status').catch(() => ({ connected: false, last_sync: null }))
  ]);
  status.value = statusPayload;
  conflicts.value = conflictRows;
  cloud.value = cloudPayload;
  loading.value = false;
}

const monitored = computed(() => status.value?.games?.filter(game => game.enabled).length || 0);
const cloudWarnings = computed(() => status.value?.games?.filter(game => game.cloud_status === 'enabled').length || 0);
const recentGames = computed(() => [...(status.value?.games || [])].slice(0, 8));
const pendingGames = computed(() => status.value?.games?.filter(game => !game.enabled).length || 0);

function statusClass(game) {
  if (conflicts.value.some(conflict => conflict.game_id === game.id)) return 'tag-conflict';
  if (!game.enabled) return 'tag-pending';
  return 'tag-sync';
}

function statusLabel(game) {
  if (conflicts.value.some(conflict => conflict.game_id === game.id)) return 'Conflito';
  if (!game.enabled) return 'Pendente';
  return 'Sync';
}

function avatarClass(game) {
  const name = game.name?.toLowerCase() || '';
  if (name.includes('baldur') || name.includes('bg3')) return 'avatar-bg3';
  if (name.includes('elden')) return 'avatar-elden';
  if (game.platform === 'steam') return 'avatar-steam';
  return 'avatar-indie';
}

onMounted(load);
</script>

<template>
  <section class="view">
    <div v-if="loading" class="empty">Carregando status...</div>
    <template v-else>
    <div v-if="conflicts.length" class="conflict-banner">
      <span>!</span>
      <p>{{ conflicts.length }} conflito(s) aguardando resolução manual em quarentena.</p>
      <button class="danger-outline">Resolver</button>
    </div>

    <div class="metric-grid">
      <article class="metric metric-red">
        <span>Syncthing</span>
        <strong class="value-red">
          {{ status.syncthing?.online ? 'Online' : 'Indisponível' }}
        </strong>
        <small>Estado do motor P2P</small>
      </article>
      <article class="metric metric-blue">
        <span>Jogos</span>
        <strong class="value-blue">{{ status.games?.length || 0 }}</strong>
        <small>Fontes detectadas</small>
      </article>
      <article class="metric metric-amber">
        <span>Monitorados</span>
        <strong class="value-amber">{{ monitored }}</strong>
        <small>{{ pendingGames }} pendente(s)</small>
      </article>
      <article class="metric metric-green">
        <span>Última sync</span>
        <strong class="value-green">{{ cloud?.last_sync ? 'OK' : 'Nunca' }}</strong>
        <small>{{ cloud?.last_sync || 'Rclone aguardando' }}</small>
      </article>
    </div>

    <section class="panel activity-feed">
      <div class="section-title">
        <p>Atividade recente</p>
        <button class="ghost" @click="load">Atualizar</button>
      </div>
      <article v-for="game in recentGames" :key="game.id" class="activity-item">
        <i class="game-avatar" :class="avatarClass(game)">{{ game.name?.slice(0, 1) || 'S' }}</i>
        <div>
        <strong>{{ game.name }}</strong>
        <span>{{ game.last_save_at || 'Sem sincronização ainda' }}</span>
      </div>
        <span class="badge activity-tag" :class="`tag-${game.platform || 'custom'}`">{{ game.platform || 'custom' }}</span>
        <span class="badge activity-tag" :class="statusClass(game)">{{ statusLabel(game) }}</span>
      </article>
    </section>
    </template>
  </section>
</template>
