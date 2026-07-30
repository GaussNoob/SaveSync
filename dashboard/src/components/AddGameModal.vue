<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  Check,
  FolderInput,
  FolderSearch,
  PencilLine,
  Plus,
  Radar,
  Search,
  X
} from '@lucide/vue';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'radix-vue';
import { api } from '../api.js';
import { useUiStore } from '../stores/ui.js';
import DragDropZone from './DragDropZone.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import StatusBadge from './StatusBadge.vue';

const emit = defineEmits(['close', 'added']);
const ui = useUiStore();

const tabs = [
  { id: 'scan', label: 'Escanear', icon: Radar },
  { id: 'search', label: 'Catálogo', icon: Search },
  { id: 'drag', label: 'Selecionar pasta', icon: FolderInput },
  { id: 'manual', label: 'Manual', icon: PencilLine }
];

const platforms = [
  'Steam', 'Epic', 'GOG', 'emulator', 'RetroArch', 'Dolphin', 'Yuzu',
  'Eden', 'Ryujinx', 'Cemu', 'PCSX2', 'RPCS3', 'Outro'
];

const launcherPathGroups = [
  {
    name: 'Heroic',
    paths: [
      '~/Games/Heroic',
      '~/Games/Heroic/Prefixes',
      '~/.config/heroic',
      '~/.var/app/com.heroicgameslauncher.hgl/config/heroic',
      '~/.var/app/com.heroicgameslauncher.hgl/data/heroic'
    ]
  },
  {
    name: 'Lutris',
    paths: [
      '~/Games',
      '~/Games/lutris',
      '~/.config/lutris',
      '~/.local/share/lutris',
      '~/.var/app/net.lutris.Lutris/config/lutris',
      '~/.var/app/net.lutris.Lutris/data/lutris'
    ]
  },
  {
    name: 'Prefixos Wine',
    paths: [
      'drive_c/users/<usuario>/Documents',
      'drive_c/users/<usuario>/Saved Games',
      'drive_c/users/<usuario>/AppData/Local',
      'drive_c/users/<usuario>/AppData/Roaming',
      'pfx/drive_c/users/steamuser/Documents',
      'pfx/drive_c/users/steamuser/AppData/Local',
      'pfx/drive_c/users/steamuser/AppData/Roaming'
    ]
  }
];

const active = ref('scan');
const error = ref('');
const query = ref('');
const matches = ref([]);
const searchLoading = ref(false);
const selectedKnown = ref(null);
const detected = ref(null);
const detectingKnown = ref(false);
const confirmDetected = ref(false);
const scanRows = ref([]);
const scanLoading = ref(false);
const selectedScanIds = ref(new Set());
const dragPath = ref('');
const dragIdentity = ref(null);
const dragName = ref('');
const dragPlatform = ref('Outro');
const dragExtensions = ref([]);
const identifyingPath = ref(false);
const submitting = ref(false);
const manualValidating = ref(false);
const manual = ref({
  name: '',
  platform: 'Outro',
  path: '',
  customExtension: ''
});
const manualValidation = ref(null);
const manualExtensions = ref(new Set());

let searchTimer = null;
let searchRequest = 0;
watch(query, value => {
  clearTimeout(searchTimer);
  const requestId = ++searchRequest;
  searchLoading.value = false;
  searchTimer = setTimeout(async () => {
    if (!value.trim()) {
      matches.value = [];
      return;
    }
    searchLoading.value = true;
    try {
      const result = await api('/games/search', {
        method: 'POST',
        body: JSON.stringify({ query: value })
      });
      if (requestId !== searchRequest) return;
      matches.value = result;
    } catch (requestError) {
      if (requestId === searchRequest) error.value = requestError.message;
    } finally {
      if (requestId === searchRequest) searchLoading.value = false;
    }
  }, 180);
});

let validateTimer = null;
let validationRequest = 0;
watch(() => manual.value.path, value => {
  clearTimeout(validateTimer);
  const requestId = ++validationRequest;
  manualValidating.value = false;
  manualValidation.value = null;
  manualExtensions.value = new Set();
  if (!value.trim()) return;
  const expectedPath = value.trim();
  validateTimer = setTimeout(() => validateManual(expectedPath, requestId), 250);
});

const canAddKnown = computed(() => detected.value?.path && confirmDetected.value && !detectingKnown.value);
const canAddDrag = computed(() => (
  dragPath.value && !identifyingPath.value && (dragIdentity.value?.suggested_game || dragName.value.trim())
));
const canAddManual = computed(() => manual.value.name.trim() && manualValidation.value?.exists);

let detectRequest = 0;
async function selectKnown(game) {
  const requestId = ++detectRequest;
  error.value = '';
  selectedKnown.value = game;
  detected.value = null;
  confirmDetected.value = false;
  detectingKnown.value = true;
  try {
    const result = await api('/games/detect', {
      method: 'POST',
      body: JSON.stringify({ game_id: game.id })
    });
    if (requestId !== detectRequest) return;
    detected.value = result;
    confirmDetected.value = detected.value.found;
    if (!detected.value.found) {
      active.value = 'manual';
      manual.value.name = game.name;
      manual.value.platform = game.platform;
      manual.value.path = detected.value.path;
    }
  } catch (requestError) {
    if (requestId === detectRequest) error.value = requestError.message;
  } finally {
    if (requestId === detectRequest) detectingKnown.value = false;
  }
}

async function addKnown() {
  if (!canAddKnown.value) return;
  await addGame({
    game_id: selectedKnown.value.id,
    source_path: detected.value.path,
    enabled: true
  });
}

async function runScan() {
  scanLoading.value = true;
  error.value = '';
  try {
    scanRows.value = await api('/games/scan');
    selectedScanIds.value = new Set();
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    scanLoading.value = false;
  }
}

function toggleScan(row) {
  if (row.already_monitored || !row.can_import) return;
  const next = new Set(selectedScanIds.value);
  if (next.has(row.id)) next.delete(row.id);
  else next.add(row.id);
  selectedScanIds.value = next;
}

function handleScanRowClick(row, event) {
  if (event.target.closest('button, input')) return;
  toggleScan(row);
}

function configureScannedGame(row) {
  error.value = '';
  manual.value = {
    name: row.name,
    platform: row.platform === 'steam' ? 'Steam' : row.platform || 'Outro',
    path: '',
    customExtension: ''
  };
  manualValidation.value = null;
  manualExtensions.value = new Set(row.extensions || []);
  active.value = 'manual';
}

async function addSelectedScan() {
  const games = scanRows.value
    .filter(row => selectedScanIds.value.has(row.id))
    .map(row => row.platform === 'emulator' ? {
      id: row.id,
      name: row.name,
      platform: row.platform,
      source_path: row.save_path,
      extensions: row.extensions || [],
      save_type: row.save_type || 'file'
    } : {
      game_id: row.id,
      source_path: row.save_path
    });
  submitting.value = true;
  error.value = '';
  try {
    const result = await api('/games/bulk', {
      method: 'POST',
      body: JSON.stringify({ games })
    });
    const added = Array.isArray(result) ? result : result.added || [];
    const rejected = Array.isArray(result) ? [] : result.rejected || [];
    if (added.length) {
      ui.notify({
        title: 'Jogos adicionados',
        description: added.length + ' fonte(s) entraram no monitoramento.',
        tone: 'success'
      });
    }
    if (rejected.length) {
      ui.notify({
        title: rejected.length + ' fonte(s) rejeitada(s)',
        description: rejected.map(item => item.name + ': ' + item.error).join(' '),
        tone: 'error',
        duration: 7000
      });
    }
    selectedScanIds.value = new Set();
    if (added.length) emit('added');
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    submitting.value = false;
  }
}

let identifyRequest = 0;
async function handleDroppedPath(path) {
  const requestId = ++identifyRequest;
  dragPath.value = path;
  dragIdentity.value = null;
  dragName.value = '';
  dragExtensions.value = [];
  identifyingPath.value = true;
  error.value = '';
  try {
    const result = await api('/games/identify', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
    if (requestId !== identifyRequest) return;
    dragIdentity.value = result;
    dragExtensions.value = dragIdentity.value.extensions_found || [];
    if (dragIdentity.value.suggested_game) {
      dragName.value = dragIdentity.value.suggested_game.name;
      dragPlatform.value = dragIdentity.value.suggested_game.platform;
    }
  } catch (requestError) {
    if (requestId === identifyRequest) error.value = requestError.message;
  } finally {
    if (requestId === identifyRequest) identifyingPath.value = false;
  }
}

async function addDrag() {
  const suggested = dragIdentity.value?.suggested_game;
  await addGame(suggested ? {
    game_id: suggested.id,
    source_path: dragPath.value,
    enabled: true
  } : {
    name: dragName.value,
    platform: dragPlatform.value,
    source_path: dragPath.value,
    extensions: dragExtensions.value,
    enabled: true
  });
}

async function validateManual(expectedPath, requestId) {
  manualValidating.value = true;
  error.value = '';
  try {
    const result = await api('/games/validate-path', {
      method: 'POST',
      body: JSON.stringify({ path: expectedPath })
    });
    if (requestId !== validationRequest || manual.value.path.trim() !== expectedPath) return;
    manualValidation.value = result;
    manualExtensions.value = new Set(manualValidation.value.extensions_found || []);
  } catch (requestError) {
    if (requestId === validationRequest) error.value = requestError.message;
  } finally {
    if (requestId === validationRequest) manualValidating.value = false;
  }
}

function toggleManualExtension(extension) {
  const next = new Set(manualExtensions.value);
  if (next.has(extension)) next.delete(extension);
  else next.add(extension);
  manualExtensions.value = next;
}

function addCustomExtension() {
  const extension = manual.value.customExtension.trim();
  if (!extension) return;
  const normalized = extension.startsWith('.') ? extension : '.' + extension;
  manualExtensions.value = new Set([...manualExtensions.value, normalized.toLowerCase()]);
  manual.value.customExtension = '';
}

function useManualPath(path) {
  manual.value.path = path;
}

async function addManual() {
  await addGame({
    name: manual.value.name,
    platform: manual.value.platform,
    source_path: manual.value.path,
    extensions: [...manualExtensions.value],
    enabled: true
  });
}

async function addGame(payload) {
  submitting.value = true;
  error.value = '';
  try {
    await api('/games', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    ui.notify({
      title: 'Jogo adicionado',
      description: 'A fonte de save entrou no monitoramento.',
      tone: 'success'
    });
    emit('added');
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    submitting.value = false;
  }
}

onMounted(runScan);
onUnmounted(() => {
  searchRequest += 1;
  validationRequest += 1;
  detectRequest += 1;
  identifyRequest += 1;
  clearTimeout(searchTimer);
  clearTimeout(validateTimer);
});
</script>

<template>
  <DialogRoot :open="true" @update:open="open => !open && emit('close')">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="add-game-dialog" @escape-key-down="emit('close')">
        <header class="add-dialog-header">
          <div>
            <DialogTitle class="dialog-title">Adicionar fonte de save</DialogTitle>
            <DialogDescription class="dialog-description">
              Detecte um jogo instalado ou informe o caminho monitorado.
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button class="icon-button" aria-label="Fechar">
              <X :size="16" />
            </button>
          </DialogClose>
        </header>

        <div class="add-dialog-tabs" role="tablist" aria-label="Método de adição">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            role="tab"
            :aria-selected="active === tab.id"
            :class="{ active: active === tab.id }"
            @click="active = tab.id"
          >
            <component :is="tab.icon" :size="14" />
            {{ tab.label }}
          </button>
        </div>

        <div v-if="error" class="add-dialog-error">
          <span>{{ error }}</span>
          <button class="icon-button" aria-label="Fechar erro" @click="error = ''"><X :size="13" /></button>
        </div>

        <div class="add-dialog-body">
          <section v-if="active === 'scan'" class="add-pane">
            <div class="pane-toolbar">
              <div>
                <strong>Detecção automática</strong>
                <span>Steam, launchers compatíveis e emuladores configurados.</span>
              </div>
              <button class="button button-secondary" :disabled="scanLoading" @click="runScan">
                <Radar :size="14" />
                {{ scanLoading ? 'Escaneando…' : 'Escanear novamente' }}
              </button>
            </div>

            <div v-if="scanLoading" class="scan-skeleton">
              <div v-for="index in 6" :key="index">
                <SkeletonBlock width="16px" height="16px" />
                <span>
                  <SkeletonBlock width="42%" height="10px" />
                  <SkeletonBlock width="80%" height="9px" />
                </span>
                <SkeletonBlock width="70px" height="22px" />
              </div>
            </div>
            <div v-else-if="scanRows.length" class="scan-results">
              <article
                v-for="row in scanRows"
                :key="row.id"
                class="scan-row"
                :class="{
                  disabled: row.already_monitored,
                  'requires-path': row.requires_path && !row.already_monitored
                }"
                @click="handleScanRowClick(row, $event)"
              >
                <input
                  type="checkbox"
                  :disabled="row.already_monitored || !row.can_import"
                  :checked="selectedScanIds.has(row.id)"
                  @change="toggleScan(row)"
                />
                <span>
                  <strong>{{ row.name }}</strong>
                  <small>
                    {{ row.platform }} ·
                    {{ row.requires_path ? 'instalado, save não identificado' : row.extensions?.join(', ') || 'diretório' }}
                  </small>
                  <code>{{ row.save_path || row.install_dir || 'Informe o caminho do save' }}</code>
                </span>
                <div class="scan-row-status">
                  <button
                    v-if="row.requires_path && !row.already_monitored"
                    class="button button-secondary"
                    @click.stop="configureScannedGame(row)"
                  >
                    Informar save
                  </button>
                  <StatusBadge :type="row.already_monitored ? 'neutral' : row.can_import ? 'success' : 'warning'">
                    {{ row.already_monitored ? 'Adicionado' : row.can_import ? 'Save encontrado' : 'Instalado' }}
                  </StatusBadge>
                </div>
              </article>
            </div>
            <EmptyState
              v-else
              compact
              :icon="FolderSearch"
              title="Nenhuma fonte detectada"
              description="Use o catálogo ou informe um caminho manualmente."
            />

            <footer class="pane-actions">
              <span>{{ selectedScanIds.size }} selecionado(s)</span>
              <button
                class="button button-primary"
                :disabled="!selectedScanIds.size || submitting"
                @click="addSelectedScan"
              >
                <Plus :size="14" />
                {{ submitting ? 'Adicionando…' : 'Adicionar selecionados' }}
              </button>
            </footer>
          </section>

          <section v-else-if="active === 'search'" class="add-pane">
            <label class="dialog-search">
              <Search :size="15" />
              <input v-model="query" placeholder="Buscar por nome, alias ou plataforma" />
            </label>
            <div v-if="searchLoading" class="catalog-skeleton">
              <SkeletonBlock v-for="index in 4" :key="index" height="44px" />
            </div>
            <div v-else-if="matches.length" class="catalog-results">
              <button v-for="game in matches" :key="game.id" @click="selectKnown(game)">
                <span class="game-glyph">{{ String(game.name).slice(0, 1) }}</span>
                <span>
                  <strong>{{ game.name }}</strong>
                  <small>{{ game.platform }} · {{ game.extensions?.join(', ') || 'diretório' }}</small>
                </span>
              </button>
            </div>

            <div v-if="detectingKnown" class="detect-card">
              <SkeletonBlock width="110px" height="22px" />
              <SkeletonBlock height="34px" />
            </div>
            <div v-else-if="detected" class="detect-card">
              <div>
                <StatusBadge :type="detected.found ? 'success' : 'danger'">
                  {{ detected.found ? 'Caminho validado' : 'Não encontrado' }}
                </StatusBadge>
                <code>{{ detected.path }}</code>
              </div>
              <label v-if="detected.found" class="confirmation-check">
                <input v-model="confirmDetected" type="checkbox" />
                Confirmo este caminho
              </label>
              <p v-else>O caminho padrão não existe. Ele foi copiado para a aba Manual para ajuste.</p>
              <button class="button button-primary" :disabled="!canAddKnown || submitting" @click="addKnown">
                <Plus :size="14" />
                Adicionar fonte
              </button>
            </div>
          </section>

          <section v-else-if="active === 'drag'" class="add-pane">
            <DragDropZone @path="handleDroppedPath" />
            <div v-if="identifyingPath" class="detect-card">
              <SkeletonBlock width="130px" height="22px" />
              <SkeletonBlock height="34px" />
            </div>
            <div v-else-if="dragPath" class="detect-card">
              <div>
                <StatusBadge :type="dragIdentity?.suggested_game ? 'success' : 'neutral'">
                  {{ dragIdentity?.suggested_game ? 'Jogo identificado' : 'Fonte personalizada' }}
                </StatusBadge>
                <code>{{ dragPath }}</code>
              </div>
              <p v-if="dragIdentity?.suggested_game">{{ dragIdentity.suggested_game.name }}</p>
              <div v-else class="drag-fields">
                <label class="settings-field">
                  <span>Nome do jogo</span>
                  <input v-model="dragName" />
                </label>
                <label class="settings-field">
                  <span>Plataforma</span>
                  <select v-model="dragPlatform">
                    <option v-for="platform in platforms" :key="platform">{{ platform }}</option>
                  </select>
                </label>
              </div>
              <small>Extensões: {{ dragExtensions.join(', ') || 'diretório completo' }}</small>
              <button class="button button-primary" :disabled="!canAddDrag || submitting" @click="addDrag">
                <Plus :size="14" />
                Adicionar fonte
              </button>
            </div>
          </section>

          <section v-else class="add-pane manual-pane">
            <div class="manual-fields">
              <label class="settings-field">
                <span>Nome do jogo</span>
                <input v-model="manual.name" />
              </label>
              <label class="settings-field">
                <span>Plataforma</span>
                <select v-model="manual.platform">
                  <option v-for="platform in platforms" :key="platform">{{ platform }}</option>
                </select>
              </label>
              <label class="settings-field manual-path-field">
                <span>Caminho completo</span>
                <input v-model="manual.path" class="font-mono" />
                <small>O caminho é validado automaticamente após a digitação.</small>
              </label>
            </div>

            <details class="known-paths">
              <summary>Caminhos comuns de launchers e prefixos</summary>
              <div>
                <section v-for="group in launcherPathGroups" :key="group.name">
                  <strong>{{ group.name }}</strong>
                  <button v-for="path in group.paths" :key="path" type="button" @click="useManualPath(path)">
                    <code>{{ path }}</code>
                  </button>
                </section>
              </div>
            </details>

            <div v-if="manualValidating" class="detect-card">
              <SkeletonBlock width="120px" height="22px" />
              <SkeletonBlock height="34px" />
            </div>
            <div v-else-if="manualValidation" class="detect-card">
              <div>
                <StatusBadge :type="manualValidation.exists ? 'success' : 'danger'">
                  {{ manualValidation.exists ? 'Caminho válido' : 'Caminho inválido' }}
                </StatusBadge>
                <span>{{ manualValidation.file_count }} arquivo(s) encontrado(s)</span>
              </div>
              <div v-if="manualValidation.extensions_found?.length" class="extension-grid">
                <label v-for="extension in manualValidation.extensions_found" :key="extension">
                  <input
                    type="checkbox"
                    :checked="manualExtensions.has(extension)"
                    @change="toggleManualExtension(extension)"
                  />
                  {{ extension }}
                </label>
              </div>
              <div class="extension-add">
                <input v-model="manual.customExtension" placeholder=".sav" @keyup.enter="addCustomExtension" />
                <button class="button button-secondary" type="button" @click="addCustomExtension">
                  <Plus :size="13" />
                  Extensão
                </button>
              </div>
            </div>

            <footer class="pane-actions">
              <span>{{ manualExtensions.size }} extensão(ões) selecionada(s)</span>
              <button class="button button-primary" :disabled="!canAddManual || submitting" @click="addManual">
                <Check :size="14" />
                {{ submitting ? 'Adicionando…' : 'Adicionar fonte' }}
              </button>
            </footer>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
