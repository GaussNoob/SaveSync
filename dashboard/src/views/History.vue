<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';

const games = ref([]);
const selected = ref('');
const events = ref([]);
const message = ref('');

const selectedGame = computed(() => games.value.find(game => game.id === selected.value));

async function loadGames() {
  games.value = await api('/games');
  selected.value = games.value[0]?.id || '';
}

async function loadEvents() {
  events.value = selected.value ? await api(`/saves/${selected.value}`) : [];
}

async function restore(event) {
  await api(`/saves/${selected.value}/restore`, {
    method: 'POST',
    body: JSON.stringify({ archive_path: event.archive_path })
  });
  message.value = `${selectedGame.value?.name || 'Save'} restaurado para ${event.created_at}.`;
}

function versionNumber(index) {
  return `V${String(events.value.length - index).padStart(3, '0')}`;
}

function formatSize(size) {
  const value = Number(size || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${value} bytes`;
}

watch(selected, loadEvents);
onMounted(loadGames);
</script>

<template>
  <section class="view">
    <div class="view-actions">
      <select v-model="selected">
        <option v-for="game in games" :key="game.id" :value="game.id">{{ game.name }}</option>
      </select>
    </div>

    <section class="panel history-panel">
      <div class="history-head">
        <div>
          <p>Arquivo de versões</p>
          <strong>{{ selectedGame?.name || 'Nenhum jogo selecionado' }}</strong>
        </div>
        <span class="badge badge-platform">{{ events.length }} versões</span>
      </div>

      <div v-if="events.length" class="history-list">
        <article v-for="(event, index) in events" :key="event.id" class="history-row">
          <span class="version-chip">{{ versionNumber(index) }}</span>
          <div class="history-main">
            <strong>{{ event.created_at }}</strong>
            <code>{{ event.archive_path }}</code>
          </div>
          <div class="history-meta">
            <span>{{ formatSize(event.size) }}</span>
            <small>Local</small>
          </div>
          <button class="action-button action-restore" @click="restore(event)">Restaurar</button>
        </article>
      </div>
      <div v-if="!events.length" class="empty">Nenhuma versão arquivada ainda.</div>
      <p v-if="message" class="message">{{ message }}</p>
    </section>
  </section>
</template>
