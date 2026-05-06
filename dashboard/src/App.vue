<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from './api.js';
import { routes } from './router/index.js';
import AddGameModal from './components/AddGameModal.vue';

const route = useRoute();
const conflicts = ref([]);
const status = ref({ syncthing: { online: false } });
const cloud = ref({ connected: false });
const apiOnline = ref(false);
const showAddGame = ref(false);
const viewVersion = ref(0);
const tabs = routes.map(item => ({ ...item, id: item.name, label: item.meta.title, icon: item.meta.icon }));
const activeTitle = computed(() => route.meta.title || 'SaveSync');
const activeDescription = computed(() => route.meta.description || 'Controle local de saves, nuvem e conflitos.');
const globalStatus = computed(() => {
  if (!apiOnline.value) return 'Offline';
  return status.value.syncthing?.online ? 'Sincronizado' : 'Local';
});
const globalStatusClass = computed(() => ({
  'badge-offline': !apiOnline.value,
  'badge-pending': apiOnline.value && !status.value.syncthing?.online
}));
const cloudLabel = computed(() => cloud.value.connected ? 'Nuvem OK' : 'Nuvem off');

async function refreshShell() {
  const [conflictRows, statusPayload, cloudPayload] = await Promise.all([
    api('/conflicts').catch(() => []),
    api('/status').catch(error => ({ api_error: error.message, syncthing: { online: false } })),
    api('/cloud/status').catch(() => ({ connected: false }))
  ]);
  conflicts.value = conflictRows;
  status.value = statusPayload;
  apiOnline.value = !statusPayload.api_error;
  cloud.value = cloudPayload;
}

async function handleContentChanged() {
  viewVersion.value += 1;
  await refreshShell();
}

async function handleGameAdded() {
  showAddGame.value = false;
  await handleContentChanged();
}

function iconPath(icon) {
  const paths = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    library: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5v5l4 2',
    alert: 'M12 3 2 21h20zM12 9v5M12 17h.01',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4h2M2 12h2M12 2v2M12 20v2'
  };
  return paths[icon];
}

onMounted(refreshShell);
</script>

<template>
  <div class="shell">
    <div class="sync-particles" aria-hidden="true">
      <span v-for="index in 18" :key="index"></span>
    </div>
    <aside class="sidebar">
      <div class="brand">
        <div class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 10h10a5 5 0 0 1 4.6 7l-.4 1a2.2 2.2 0 0 1-3.8.5L15.8 16H8.2l-1.6 2.5a2.2 2.2 0 0 1-3.8-.5l-.4-1A5 5 0 0 1 7 10Z" />
            <path d="M8 13v3M6.5 14.5h3M16.5 14.5h.01M18.5 13.5h.01" />
          </svg>
        </div>
        <div>
          <strong>SaveSync</strong>
          <span>Guardião de saves</span>
        </div>
      </div>
      <nav>
        <router-link
          v-for="tab in tabs"
          :key="tab.id"
          :to="tab.path"
          :class="{ active: route.name === tab.id }"
        >
          <svg viewBox="0 0 24 24"><path :d="iconPath(tab.icon)" /></svg>
          <span>{{ tab.label }}</span>
          <b v-if="tab.id === 'conflicts' && conflicts.length" class="nav-badge">{{ conflicts.length }}</b>
        </router-link>
      </nav>
      <div class="syncthing-status">
        <span class="status-dot" :class="{ offline: !status.syncthing?.online }"></span>
        <div>
          <strong>Syncthing</strong>
          <span>{{ status.syncthing?.online ? 'Conectado' : 'Aguardando' }}</span>
        </div>
      </div>
    </aside>
    <main>
      <div class="topbar">
        <div>
          <h1>{{ activeTitle }}</h1>
          <p>{{ activeDescription }}</p>
        </div>
        <div class="topbar-actions">
          <span class="badge badge-ok" :class="globalStatusClass">{{ globalStatus }}</span>
          <span class="badge badge-cloud" :class="{ 'badge-pending': !cloud.connected }">{{ cloudLabel }}</span>
          <button class="primary command-button add-button" @click="showAddGame = true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span>Adicionar</span>
          </button>
        </div>
      </div>
      <router-view v-slot="{ Component }">
        <component
          :is="Component"
          :key="`${route.fullPath}-${viewVersion}`"
          @open-add-game="showAddGame = true"
          @changed="handleContentChanged"
        />
      </router-view>
      <AddGameModal v-if="showAddGame" @close="showAddGame = false" @added="handleGameAdded" />
    </main>
  </div>
</template>
