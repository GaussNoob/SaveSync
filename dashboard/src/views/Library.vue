<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['changed']);
const games = ref([]);
const loading = ref(true);
const error = ref('');

const grouped = computed(() => games.value.reduce((acc, game) => {
  const key = game.platform || 'pc';
  acc[key] = acc[key] || [];
  acc[key].push(game);
  return acc;
}, {}));
const enabledCount = computed(() => games.value.filter(game => game.enabled).length);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    games.value = await api('/games');
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function scan() {
  await api('/games/scan');
  await load();
}

async function toggle(game) {
  try {
    await api(`/games/${game.id}/${game.enabled ? 'disable' : 'enable'}`, {
      method: 'POST',
      body: JSON.stringify({ monitor_mode: game.cloud_status === 'enabled' ? 'readonly' : 'sync' })
    });
    emit('changed');
  } catch (err) {
    error.value = err.message;
  }
  await load();
}

async function disableCloud(game) {
  await api(`/games/${game.id}/steam-cloud/disable`, { method: 'POST' });
  emit('changed');
  await load();
}

async function removeGame(game) {
  if (!window.confirm(`Remover "${game.name}" da biblioteca? Os arquivos originais do save não serão apagados.`)) return;
  try {
    await api(`/games/${game.id}`, { method: 'DELETE' });
    emit('changed');
  } catch (err) {
    error.value = err.message;
  }
  await load();
}

function openSteamProperties(game) {
  if (!game.steam_appid) return;
  window.open(`steam://nav/games/details/${game.steam_appid}`, '_blank');
}

function gameInitials(game) {
  const words = String(game.name || game.platform || 'SaveSync')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.map(word => word[0]).join('').toUpperCase();
}

function extensions(game) {
  return game.extensions?.length ? game.extensions.join(', ') : 'diretório';
}

onMounted(load);
</script>

<template>
  <section class="view">
    <div class="view-toolbar">
      <div>
        <strong>{{ games.length }} fontes</strong>
        <span>{{ enabledCount }} monitoradas</span>
      </div>
      <button class="command-button scan-button" @click="scan">Escanear</button>
    </div>

    <div v-if="loading" class="empty">Carregando biblioteca...</div>
    <div v-else-if="error" class="empty">{{ error }}</div>
    <section v-for="(items, platform) in grouped" v-else :key="platform" class="panel">
      <div class="section-title">
        <p>{{ platform }}</p>
        <span class="badge badge-platform">{{ items.length }} fontes</span>
      </div>
      <div class="cards">
        <article v-for="game in items" :key="game.id" class="game-card">
          <div class="game-main">
            <div class="game-icon">{{ gameInitials(game) }}</div>
            <div>
              <strong>{{ game.name }}</strong>
              <span>{{ game.platform }} • {{ extensions(game) }} • {{ game.last_save_at || '0 versões' }}</span>
              <code>{{ game.source_path }}</code>
            </div>
          </div>
          <div class="actions">
            <span v-if="game.cloud_status === 'enabled'" class="badge badge-pending">Steam Cloud</span>
            <span class="badge" :class="game.enabled ? 'badge-ok' : 'badge-pending'">{{ game.enabled ? 'Sync' : 'Pendente' }}</span>
            <button v-if="game.cloud_status === 'enabled'" class="action-button action-secondary" @click="disableCloud(game)">Desabilitar Cloud</button>
            <button v-if="game.cloud_save && game.steam_appid" class="action-button action-secondary" @click="openSteamProperties(game)">Abrir Steam</button>
            <button
              class="action-button"
              :class="game.enabled ? 'action-stop' : 'action-monitor'"
              @click="toggle(game)"
            >
              {{ game.enabled ? 'Parar' : 'Monitorar' }}
            </button>
            <button class="action-button action-danger" @click="removeGame(game)">Excluir</button>
          </div>
        </article>
      </div>
    </section>
  </section>
</template>
