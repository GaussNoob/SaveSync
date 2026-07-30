<script setup>
import { computed, onMounted, ref } from 'vue';
import { onKeyStroke } from '@vueuse/core';
import {
  Check,
  ClipboardCopy,
  CloudOff,
  ExternalLink,
  FolderSearch,
  Gamepad2,
  MoreHorizontal,
  Plus,
  Search,
  SearchX,
  SlidersHorizontal,
  Trash2
} from '@lucide/vue';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SwitchRoot,
  SwitchThumb
} from 'radix-vue';
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
import { api } from '../api.js';
import { useUiStore } from '../stores/ui.js';
import { isEditableTarget } from '../utils/dom.js';
import { formatRelativeTime, platformLabel } from '../utils/formatters.js';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import SkeletonBlock from '../components/SkeletonBlock.vue';
import StatusBadge from '../components/StatusBadge.vue';

const emit = defineEmits(['changed', 'open-add-game']);
const ui = useUiStore();
const games = ref([]);
const searchInput = ref(null);
const loading = ref(true);
const error = ref('');
const query = ref('');
const platformFilter = ref('all');
const pendingIds = ref(new Set());
const confirmation = ref({ open: false, type: '', game: null });
const confirmationBusy = ref(false);

const enabledCount = computed(() => games.value.filter(game => game.enabled).length);
const platformOptions = computed(() => {
  const values = [...new Set(games.value.map(game => game.platform || 'pc'))]
    .sort((a, b) => platformLabel(a).localeCompare(platformLabel(b), 'pt-BR'));
  return [
    { value: 'all', label: 'Todas as plataformas' },
    ...values.map(value => ({ value, label: platformLabel(value) }))
  ];
});
const selectedPlatformLabel = computed(() => (
  platformOptions.value.find(option => option.value === platformFilter.value)?.label || 'Todas as plataformas'
));
const filteredGames = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('pt-BR');
  return games.value.filter(game => {
    const matchesPlatform = platformFilter.value === 'all' || game.platform === platformFilter.value;
    if (!matchesPlatform) return false;
    if (!needle) return true;
    return [game.name, game.source_path, game.platform, ...(game.extensions || [])]
      .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(needle));
  });
});
const confirmationTitle = computed(() => {
  if (confirmation.value.type === 'remove') return 'Remover jogo da biblioteca?';
  return 'Desativar Steam Cloud?';
});
const confirmationDescription = computed(() => {
  const game = confirmation.value.game;
  if (!game) return '';
  if (confirmation.value.type === 'remove') {
    return '“' + game.name + '” deixará de ser monitorado. Os arquivos originais do save não serão apagados.';
  }
  return 'O Steam Cloud de “' + game.name + '” será desativado e o SaveSync criará um backup do localconfig.vdf.';
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    games.value = await api('/games');
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    loading.value = false;
  }
}

function openScanner() {
  emit('open-add-game');
}

async function toggle(game, desired = !game.enabled) {
  if (pendingIds.value.has(game.id) || desired === game.enabled) return;
  const previous = game.enabled;
  setPending(game.id, true);
  game.enabled = desired;
  try {
    await api('/games/' + game.id + '/' + (desired ? 'enable' : 'disable'), {
      method: 'POST',
      body: JSON.stringify({
        monitor_mode: game.cloud_status === 'enabled' ? 'readonly' : 'sync'
      })
    });
    ui.notify({
      title: desired ? 'Monitoramento ativado' : 'Monitoramento pausado',
      description: game.name,
      tone: 'success'
    });
    emit('changed');
  } catch (requestError) {
    game.enabled = previous;
    ui.notify({
      title: 'Não foi possível atualizar o jogo',
      description: requestError.message,
      tone: 'error'
    });
  } finally {
    setPending(game.id, false);
  }
}

function requestConfirmation(type, game) {
  confirmation.value = { open: true, type, game };
}

async function confirmAction() {
  const { type, game } = confirmation.value;
  if (!game) return;
  confirmationBusy.value = true;
  if (type === 'remove') await removeGame(game);
  else await disableCloud(game);
  confirmationBusy.value = false;
  confirmation.value = { open: false, type: '', game: null };
}

async function disableCloud(game) {
  const previous = game.cloud_status;
  game.cloud_status = 'disabled';
  setPending(game.id, true);
  try {
    await api('/games/' + game.id + '/steam-cloud/disable', {
      method: 'POST',
      body: JSON.stringify({ confirm: true })
    });
    ui.notify({
      title: 'Steam Cloud desativado',
      description: 'O backup da configuração foi criado para ' + game.name + '.',
      tone: 'success'
    });
    emit('changed');
  } catch (requestError) {
    game.cloud_status = previous;
    ui.notify({
      title: 'Steam Cloud não foi alterado',
      description: requestError.message,
      tone: 'error'
    });
  } finally {
    setPending(game.id, false);
  }
}

async function removeGame(game) {
  const index = games.value.findIndex(item => item.id === game.id);
  if (index < 0) return;
  games.value.splice(index, 1);
  try {
    await api('/games/' + game.id, { method: 'DELETE' });
    ui.notify({
      title: 'Jogo removido',
      description: game.name + ' não será mais monitorado.',
      tone: 'success'
    });
    emit('changed');
  } catch (requestError) {
    games.value.splice(index, 0, game);
    ui.notify({
      title: 'Não foi possível remover o jogo',
      description: requestError.message,
      tone: 'error'
    });
  }
}

function setPending(id, pending) {
  const next = new Set(pendingIds.value);
  if (pending) next.add(id);
  else next.delete(id);
  pendingIds.value = next;
}

function openSteamProperties(game) {
  if (game.steam_appid) window.open('steam://nav/games/details/' + game.steam_appid, '_blank');
}

function gameInitials(game) {
  return String(game.name || game.platform || 'SaveSync')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

function extensionLabel(game) {
  return game.extensions?.length ? game.extensions.slice(0, 3).join(', ') : 'Diretório completo';
}

async function copyPath(game) {
  try {
    await navigator.clipboard.writeText(game.source_path);
    ui.notify({
      title: 'Caminho copiado',
      description: game.source_path,
      tone: 'success'
    });
  } catch {
    ui.notify({
      title: 'Não foi possível copiar',
      description: 'A área de transferência não está disponível neste contexto.',
      tone: 'error'
    });
  }
}

onKeyStroke('/', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
  event.preventDefault();
  searchInput.value?.focus();
});

onMounted(load);
</script>

<template>
  <section class="view games-view">
    <div class="games-toolbar panel">
      <div class="games-summary">
        <strong>{{ games.length }}</strong>
        <span>fontes</span>
        <i></i>
        <strong>{{ enabledCount }}</strong>
        <span>monitoradas</span>
      </div>

      <label class="search-control">
        <Search :size="15" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="Buscar por jogo ou caminho"
          @keydown.esc="query = ''"
        />
        <kbd v-if="!query" class="search-hint" aria-hidden="true">/</kbd>
      </label>

      <DropdownMenuRoot>
        <DropdownMenuTrigger as-child>
          <button class="button button-secondary platform-filter">
            <SlidersHorizontal :size="14" />
            <span>{{ selectedPlatformLabel }}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="menu-content" :side-offset="6" align="end">
            <DropdownMenuItem
              v-for="option in platformOptions"
              :key="option.value"
              class="menu-item"
              @select="platformFilter = option.value"
            >
              <Check :size="13" :class="{ invisible: platformFilter !== option.value }" />
              {{ option.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>

      <button class="button button-secondary" @click="openScanner">
        <FolderSearch :size="15" />
        Escanear
      </button>
      <button class="button button-primary" @click="emit('open-add-game')">
        <Plus :size="15" />
        Adicionar
      </button>
    </div>

    <div v-if="error" class="inline-alert" data-tone="danger">
      <Gamepad2 :size="16" />
      <div>
        <strong>Não foi possível carregar a biblioteca</strong>
        <span>{{ error }}</span>
      </div>
      <button class="button button-secondary" @click="load">Tentar novamente</button>
    </div>

    <section class="panel games-panel">
      <div class="games-table-head">
        <span>Jogo / origem</span>
        <span>Plataforma</span>
        <span>Último save</span>
        <span>Monitoramento</span>
        <span aria-hidden="true"></span>
      </div>

      <div v-if="loading" class="games-skeleton">
        <div v-for="index in 8" :key="index">
          <SkeletonBlock width="30px" height="30px" />
          <span>
            <SkeletonBlock width="42%" height="10px" />
            <SkeletonBlock width="76%" height="9px" />
          </span>
          <SkeletonBlock width="62px" height="10px" />
          <SkeletonBlock width="82px" height="10px" />
          <SkeletonBlock width="72px" height="22px" />
        </div>
      </div>

      <DynamicScroller
        v-else-if="filteredGames.length"
        :items="filteredGames"
        :min-item-size="66"
        key-field="id"
        class="games-scroller"
      >
        <template #default="{ item: game, index, active }">
          <DynamicScrollerItem
            :item="game"
            :active="active"
            :data-index="index"
            :size-dependencies="[game.source_path, game.enabled, game.cloud_status]"
          >
            <article class="game-row">
              <div class="game-identity">
                <span class="game-glyph">{{ gameInitials(game) }}</span>
                <span>
                  <strong>{{ game.name }}</strong>
                  <code :title="game.source_path">{{ game.source_path }}</code>
                  <small>{{ extensionLabel(game) }}</small>
                </span>
              </div>
              <span class="game-platform">{{ platformLabel(game.platform) }}</span>
              <span class="game-last-save font-mono">
                {{ formatRelativeTime(game.last_save_at, 'Sem versão') }}
              </span>
              <div class="game-monitor">
                <SwitchRoot
                  class="switch-root"
                  :checked="Boolean(game.enabled)"
                  :disabled="pendingIds.has(game.id)"
                  :aria-label="(game.enabled ? 'Pausar ' : 'Monitorar ') + game.name"
                  @update:checked="checked => toggle(game, checked)"
                >
                  <SwitchThumb class="switch-thumb" />
                </SwitchRoot>
                <StatusBadge :type="game.enabled ? 'success' : 'neutral'">
                  {{ game.enabled ? 'Ativo' : 'Pausado' }}
                </StatusBadge>
                <StatusBadge v-if="game.cloud_status === 'enabled'" type="warning">Steam Cloud</StatusBadge>
              </div>
              <DropdownMenuRoot>
                <DropdownMenuTrigger as-child>
                  <button class="icon-button row-menu-trigger" :aria-label="'Ações de ' + game.name">
                    <MoreHorizontal :size="16" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent class="menu-content" :side-offset="6" align="end">
                    <DropdownMenuItem class="menu-item" @select="toggle(game)">
                      <Check :size="14" />
                      {{ game.enabled ? 'Pausar monitoramento' : 'Ativar monitoramento' }}
                    </DropdownMenuItem>
                    <DropdownMenuItem class="menu-item" @select="copyPath(game)">
                      <ClipboardCopy :size="14" />
                      Copiar caminho
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="game.cloud_status === 'enabled'"
                      class="menu-item"
                      @select="requestConfirmation('disable-cloud', game)"
                    >
                      <CloudOff :size="14" />
                      Desativar Steam Cloud
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-if="game.cloud_save && game.steam_appid"
                      class="menu-item"
                      @select="openSteamProperties(game)"
                    >
                      <ExternalLink :size="14" />
                      Abrir no Steam
                    </DropdownMenuItem>
                    <DropdownMenuSeparator class="menu-separator" />
                    <DropdownMenuItem
                      class="menu-item menu-item-danger"
                      @select="requestConfirmation('remove', game)"
                    >
                      <Trash2 :size="14" />
                      Remover da biblioteca
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenuRoot>
            </article>
          </DynamicScrollerItem>
        </template>
      </DynamicScroller>

      <EmptyState
        v-else-if="games.length"
        :icon="SearchX"
        title="Nenhum resultado"
        description="Ajuste a busca ou limpe o filtro de plataforma."
      >
        <template #action>
          <button class="button button-secondary" @click="query = ''; platformFilter = 'all'">
            Limpar filtros
          </button>
        </template>
      </EmptyState>

      <EmptyState
        v-else
        :icon="Gamepad2"
        title="Nenhum jogo configurado"
        description="Execute uma varredura automática ou informe o caminho de uma fonte de save."
      >
        <template #action>
          <button class="button button-primary" @click="emit('open-add-game')">
            <Plus :size="15" />
            Adicionar jogo
          </button>
        </template>
      </EmptyState>
    </section>

    <ConfirmDialog
      :open="confirmation.open"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :confirm-label="confirmation.type === 'remove' ? 'Remover jogo' : 'Desativar Cloud'"
      :busy="confirmationBusy"
      @update:open="confirmation.open = $event"
      @confirm="confirmAction"
    />
  </section>
</template>
