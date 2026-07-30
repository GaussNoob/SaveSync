<script setup>
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import { onKeyStroke, useDark, useIntervalFn } from '@vueuse/core';
import { TooltipProvider } from 'radix-vue';
import {
  AlertTriangle,
  Check,
  Cloud,
  Gamepad2,
  History,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  WifiOff,
  X
} from '@lucide/vue';
import { api } from './api.js';
import { routes } from './router/index.js';
import { isEditableTarget } from './utils/dom.js';
import { useRealtimeStore } from './stores/realtime.js';
import AddGameModal from './components/AddGameModal.vue';
import AppTooltip from './components/AppTooltip.vue';
import StatusBadge from './components/StatusBadge.vue';
import ToastCenter from './components/ToastCenter.vue';

useDark({
  initialValue: 'dark',
  storageKey: 'savesync.color-scheme',
  valueDark: 'dark',
  valueLight: 'light'
});

const route = useRoute();
const realtime = useRealtimeStore();
const conflicts = ref([]);
const status = ref({ syncthing: { online: false } });
const cloud = ref({ connected: false });
const apiOnline = ref(false);
const shellLoading = ref(true);
const shellRefreshing = ref(false);
const showAddGame = ref(false);
const sidebarOpen = ref(false);
const viewVersion = ref(0);
const lastShellRefresh = ref(null);
let shellRefreshPromise = null;

const iconMap = {
  overview: LayoutDashboard,
  games: Gamepad2,
  conflicts: ShieldAlert,
  history: History,
  settings: Settings
};

const tabs = routes.map(item => ({
  ...item,
  id: item.name,
  label: item.meta.title,
  icon: iconMap[item.meta.icon]
}));

const activeTitle = computed(() => route.meta.title || 'SaveSync');
const activeDescription = computed(() => route.meta.description || 'Controle local de saves, nuvem e conflitos.');
const globalStatus = computed(() => {
  if (!apiOnline.value) return { label: 'API offline', tone: 'danger', icon: WifiOff };
  if (realtime.syncState === 'syncing') return { label: 'Sincronizando', tone: 'accent', icon: RefreshCw };
  if (realtime.syncState === 'error') return { label: 'Falha de sync', tone: 'danger', icon: AlertTriangle };
  if (!status.value.syncthing?.online) return { label: 'Somente local', tone: 'warning', icon: Check };
  return { label: 'Em dia', tone: 'success', icon: Check };
});
const cloudLabel = computed(() => cloud.value.connected ? 'Nuvem conectada' : 'Nuvem desconectada');
const systemDetail = computed(() => {
  if (!apiOnline.value) return 'Backend indisponível';
  if (realtime.syncState === 'syncing') return realtime.syncMessage;
  if (realtime.syncState === 'error') return realtime.syncMessage;
  return status.value.syncthing?.online ? 'Syncthing conectado' : 'Syncthing aguardando';
});

function refreshShell() {
  if (shellRefreshPromise) return shellRefreshPromise;
  shellRefreshing.value = true;
  shellRefreshPromise = Promise.all([
    api('/conflicts').catch(() => []),
    api('/status').catch(error => ({ api_error: error.message, syncthing: { online: false } })),
    api('/cloud/status').catch(() => ({ connected: false }))
  ]).then(([conflictRows, statusPayload, cloudPayload]) => {
    conflicts.value = conflictRows;
    status.value = statusPayload;
    apiOnline.value = !statusPayload.api_error;
    cloud.value = cloudPayload;
    lastShellRefresh.value = new Date().toISOString();
  }).finally(() => {
    shellLoading.value = false;
    shellRefreshing.value = false;
    shellRefreshPromise = null;
  });
  return shellRefreshPromise;
}

async function handleContentChanged(options = {}) {
  if (options.reloadView) viewVersion.value += 1;
  if (options.reconnectRealtime) realtime.reconnect();
  await refreshShell();
}

async function handleGameAdded() {
  showAddGame.value = false;
  await handleContentChanged({ reloadView: true });
}

function openAddGame() {
  showAddGame.value = true;
  sidebarOpen.value = false;
}

onKeyStroke('n', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
  event.preventDefault();
  openAddGame();
});

onKeyStroke('Escape', () => {
  if (sidebarOpen.value) sidebarOpen.value = false;
});

// Surface the current view and any pending conflicts in the window/tab title.
watchEffect(() => {
  const base = route.meta.title ? route.meta.title + ' · SaveSync' : 'SaveSync';
  document.title = conflicts.value.length ? '(' + conflicts.value.length + ') ' + base : base;
});

const { pause: pauseRefresh, resume: resumeRefresh } = useIntervalFn(
  refreshShell,
  20000,
  { immediate: false }
);

onMounted(() => {
  void refreshShell();
  realtime.connect();
  resumeRefresh();
});

onUnmounted(pauseRefresh);
</script>

<template>
  <TooltipProvider :delay-duration="350" :skip-delay-duration="100">
    <div class="app-shell">
      <button
        v-if="sidebarOpen"
        class="sidebar-scrim"
        aria-label="Fechar navegação"
        @click="sidebarOpen = false"
      ></button>

      <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <RefreshCw :size="17" :stroke-width="1.7" />
          </span>
          <div class="brand-copy">
            <strong>SaveSync</strong>
            <span>Self-hosted</span>
          </div>
          <button class="icon-button mobile-sidebar-close" aria-label="Fechar menu" @click="sidebarOpen = false">
            <X :size="17" />
          </button>
        </div>

        <nav class="sidebar-nav" aria-label="Navegação principal">
          <span class="nav-section-label">Workspace</span>
          <router-link
            v-for="tab in tabs"
            :key="tab.id"
            :to="tab.path"
            :class="{ active: route.name === tab.id }"
            @click="sidebarOpen = false"
          >
            <component :is="tab.icon" :size="17" :stroke-width="1.65" aria-hidden="true" />
            <span>{{ tab.label }}</span>
            <span v-if="tab.id === 'conflicts' && conflicts.length" class="nav-count">{{ conflicts.length }}</span>
          </router-link>
        </nav>

        <div class="sidebar-footer">
          <div class="system-status">
            <span class="system-status-icon" :data-tone="globalStatus.tone">
              <component
                :is="globalStatus.icon"
                :size="17"
                :class="{ spinning: realtime.syncState === 'syncing' }"
                aria-hidden="true"
              />
            </span>
            <div>
              <strong>{{ globalStatus.label }}</strong>
              <span>{{ systemDetail }}</span>
            </div>
          </div>
          <div class="sidebar-meta">
            <span>
              <Cloud :size="13" aria-hidden="true" />
              {{ cloudLabel }}
            </span>
            <span :class="{ 'text-success': realtime.status === 'OPEN' }">
              Live {{ realtime.status === 'OPEN' ? 'online' : 'offline' }}
            </span>
          </div>
        </div>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div class="topbar-heading">
            <button class="icon-button mobile-menu" aria-label="Abrir navegação" @click="sidebarOpen = true">
              <Menu :size="18" />
            </button>
            <div>
              <h1>{{ activeTitle }}</h1>
              <p>{{ activeDescription }}</p>
            </div>
          </div>
          <div class="topbar-actions">
            <p class="sr-only" role="status" aria-live="polite">
              {{ globalStatus.label }}. {{ systemDetail }}
            </p>
            <AppTooltip :text="realtime.syncMessage">
              <StatusBadge :type="globalStatus.tone">
                {{ shellLoading ? 'Conectando' : globalStatus.label }}
              </StatusBadge>
            </AppTooltip>
            <AppTooltip text="Atualizar dados">
              <button class="icon-button" aria-label="Atualizar dados" @click="refreshShell">
                <RefreshCw :size="16" :class="{ spinning: shellRefreshing }" />
              </button>
            </AppTooltip>
            <button class="button button-primary add-game-button" @click="openAddGame">
              <Plus :size="16" />
              <span>Adicionar jogo</span>
              <kbd>N</kbd>
            </button>
          </div>
        </header>

        <div class="route-stage">
          <router-view v-slot="{ Component }">
            <transition name="route" appear>
              <component
                :is="Component"
                :key="route.fullPath + '-' + viewVersion"
                @open-add-game="openAddGame"
                @changed="handleContentChanged"
              />
            </transition>
          </router-view>
        </div>

        <AddGameModal
          v-if="showAddGame"
          @close="showAddGame = false"
          @added="handleGameAdded"
        />
      </main>
      <ToastCenter />
    </div>
  </TooltipProvider>
</template>
