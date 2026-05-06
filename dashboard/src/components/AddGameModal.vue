<script setup>
import { computed, ref, watch } from 'vue';
import { api } from '../api.js';
import DragDropZone from './DragDropZone.vue';
import StatusBadge from './StatusBadge.vue';

const emit = defineEmits(['close', 'added']);

const tabs = [
  { id: 'scan', label: 'Escanear' },
  { id: 'search', label: 'Catálogo' },
  { id: 'drag', label: 'Soltar pasta' },
  { id: 'manual', label: 'Manual' }
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
    name: 'Saves comuns em prefixos Wine',
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
const loading = ref(false);
const error = ref('');
const success = ref('');

const query = ref('');
const matches = ref([]);
const selectedKnown = ref(null);
const detected = ref(null);
const confirmDetected = ref(false);

const scanRows = ref([]);
const selectedScanIds = ref(new Set());

const dragPath = ref('');
const dragIdentity = ref(null);
const dragName = ref('');
const dragPlatform = ref('Outro');
const dragExtensions = ref([]);

const manual = ref({
  name: '',
  platform: 'Outro',
  path: '',
  customExtension: ''
});
const manualValidation = ref(null);
const manualExtensions = ref(new Set());

let searchTimer = null;
watch(query, value => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    if (!value.trim()) {
      matches.value = [];
      return;
    }
    matches.value = await api('/games/search', {
      method: 'POST',
      body: JSON.stringify({ query: value })
    });
  }, 180);
});

let validateTimer = null;
watch(() => manual.value.path, value => {
  clearTimeout(validateTimer);
  manualValidation.value = null;
  if (!value.trim()) return;
  validateTimer = setTimeout(() => validateManual(), 250);
});

const canAddKnown = computed(() => detected.value?.path && confirmDetected.value);
const canAddDrag = computed(() => dragPath.value && (dragIdentity.value?.suggested_game || dragName.value.trim()));
const canAddManual = computed(() => manual.value.name.trim() && manualValidation.value?.exists);

async function selectKnown(game) {
  error.value = '';
  success.value = '';
  selectedKnown.value = game;
  loading.value = true;
  try {
    detected.value = await api('/games/detect', {
      method: 'POST',
      body: JSON.stringify({ game_id: game.id })
    });
    confirmDetected.value = detected.value.found;
    if (!detected.value.found) {
      active.value = 'manual';
      manual.value.name = game.name;
      manual.value.platform = game.platform;
      manual.value.path = detected.value.path;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
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
  loading.value = true;
  error.value = '';
  try {
    scanRows.value = await api('/games/scan');
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function toggleScan(row) {
  if (row.already_monitored) return;
  const next = new Set(selectedScanIds.value);
  if (next.has(row.id)) next.delete(row.id);
  else next.add(row.id);
  selectedScanIds.value = next;
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
  const added = await api('/games/bulk', {
    method: 'POST',
    body: JSON.stringify({ games })
  });
  success.value = `${added.length} jogo(s) adicionados.`;
  selectedScanIds.value = new Set();
  emit('added');
}

async function handleDroppedPath(path) {
  dragPath.value = path;
  loading.value = true;
  error.value = '';
  try {
    dragIdentity.value = await api('/games/identify', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
    dragExtensions.value = dragIdentity.value.extensions_found || [];
    if (dragIdentity.value.suggested_game) {
      dragName.value = dragIdentity.value.suggested_game.name;
      dragPlatform.value = dragIdentity.value.suggested_game.platform;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
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

async function validateManual() {
  loading.value = true;
  error.value = '';
  try {
    manualValidation.value = await api('/games/validate-path', {
      method: 'POST',
      body: JSON.stringify({ path: manual.value.path.trim() })
    });
    manualExtensions.value = new Set(manualValidation.value.extensions_found || []);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function toggleManualExtension(ext) {
  const next = new Set(manualExtensions.value);
  if (next.has(ext)) next.delete(ext);
  else next.add(ext);
  manualExtensions.value = next;
}

function addCustomExtension() {
  const ext = manual.value.customExtension.trim();
  if (!ext) return;
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
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
  loading.value = true;
  error.value = '';
  success.value = '';
  try {
    await api('/games', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    success.value = 'Jogo adicionado ao monitoramento.';
    emit('added');
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <section class="add-modal">
      <header>
        <div>
          <p class="modal-kicker">Adicionar jogo</p>
          <h2>Conectar uma fonte de save</h2>
        </div>
        <button class="ghost icon-button" aria-label="Fechar" @click="emit('close')">×</button>
      </header>

      <div class="modal-tabs">
        <button v-for="tab in tabs" :key="tab.id" :class="{ active: active === tab.id }" @click="active = tab.id">
          {{ tab.label }}
        </button>
      </div>

      <div v-if="loading" class="modal-feedback loading"><span></span> Processando...</div>
      <div v-if="error" class="modal-feedback error">✕ {{ error }}</div>
      <div v-if="success" class="modal-feedback ok">✓ {{ success }}</div>

      <div v-if="active === 'search'" class="modal-pane">
        <input v-model="query" placeholder="Buscar por nome, alias ou plataforma" />
        <div class="autocomplete" v-if="matches.length">
          <button v-for="game in matches" :key="game.id" @click="selectKnown(game)">
            <strong>{{ game.name }}</strong>
            <span>{{ game.platform }} • {{ game.extensions?.join(', ') || 'diretório' }}</span>
          </button>
        </div>
        <div v-if="detected" class="detect-result">
          <StatusBadge :type="detected.found ? 'ok' : 'conflict'">{{ detected.found ? 'validado' : 'não encontrado' }}</StatusBadge>
          <code>{{ detected.path }}</code>
          <label v-if="detected.found" class="check-row">
            <input v-model="confirmDetected" type="checkbox" />
            Confirmo este caminho
          </label>
          <p v-else>O caminho padrão não existe. Corrija o caminho na aba Manual.</p>
          <button class="primary" :disabled="!canAddKnown" @click="addKnown">Adicionar</button>
        </div>
      </div>

      <div v-if="active === 'scan'" class="modal-pane">
        <div class="modal-intro">
          <div>
            <strong>Detectar automaticamente</strong>
            <span>Procura Steam, saves conhecidos e emuladores configurados.</span>
          </div>
          <button class="primary" @click="runScan">Escanear</button>
        </div>
        <div class="scan-list">
          <label v-for="row in scanRows" :key="row.id" :class="{ disabled: row.already_monitored }">
            <input type="checkbox" :disabled="row.already_monitored" :checked="selectedScanIds.has(row.id)" @change="toggleScan(row)" />
            <span>
              <strong>{{ row.name }}</strong>
              <small>{{ row.platform }} • {{ row.extensions?.join(', ') || 'diretório' }}</small>
              <code>{{ row.save_path }}</code>
            </span>
            <StatusBadge :type="row.already_monitored ? 'pending' : row.found_in_system ? 'ok' : 'conflict'">
              {{ row.already_monitored ? 'Já adicionado' : row.found_in_system ? 'Encontrado' : 'Ausente' }}
            </StatusBadge>
          </label>
        </div>
        <button class="primary" :disabled="!selectedScanIds.size" @click="addSelectedScan">Adicionar selecionados</button>
      </div>

      <div v-if="active === 'drag'" class="modal-pane">
        <DragDropZone @path="handleDroppedPath" />
        <div v-if="dragPath" class="detect-result">
          <code>{{ dragPath }}</code>
          <StatusBadge v-if="dragIdentity?.suggested_game" type="ok">Sugestão encontrada</StatusBadge>
          <p v-if="dragIdentity?.suggested_game">{{ dragIdentity.suggested_game.name }}</p>
          <template v-else>
            <input v-model="dragName" placeholder="Nome do jogo" />
            <select v-model="dragPlatform">
              <option>Steam</option><option>Epic</option><option>GOG</option><option>emulator</option><option>RetroArch</option><option>Dolphin</option><option>Yuzu</option><option>Eden</option><option>Ryujinx</option><option>Cemu</option><option>PCSX2</option><option>RPCS3</option><option>Outro</option>
            </select>
          </template>
          <p>Extensões: {{ dragExtensions.join(', ') || 'diretório/sem extensão' }}</p>
          <button class="primary" :disabled="!canAddDrag" @click="addDrag">Adicionar</button>
        </div>
      </div>

      <div v-if="active === 'manual'" class="modal-pane manual-grid">
        <label>Nome do jogo <input v-model="manual.name" /></label>
        <label>Plataforma
          <select v-model="manual.platform">
            <option>Steam</option><option>Epic</option><option>GOG</option><option>emulator</option><option>RetroArch</option><option>Dolphin</option><option>Yuzu</option><option>Eden</option><option>Ryujinx</option><option>Cemu</option><option>PCSX2</option><option>RPCS3</option><option>Outro</option>
          </select>
        </label>
        <label class="wide">Caminho completo <input v-model="manual.path" /></label>
        <div class="wide launcher-paths">
          <div v-for="group in launcherPathGroups" :key="group.name">
            <strong>{{ group.name }}</strong>
            <button v-for="path in group.paths" :key="path" type="button" @click="useManualPath(path)">
              <code>{{ path }}</code>
            </button>
          </div>
        </div>
        <div v-if="manualValidation" class="wide detect-result">
          <StatusBadge :type="manualValidation.exists ? 'ok' : 'conflict'">{{ manualValidation.exists ? 'Caminho válido' : 'Inválido' }}</StatusBadge>
          <p>{{ manualValidation.file_count }} arquivo(s) encontrados</p>
          <div class="extension-grid">
            <label v-for="ext in manualValidation.extensions_found" :key="ext">
              <input type="checkbox" :checked="manualExtensions.has(ext)" @change="toggleManualExtension(ext)" />
              {{ ext }}
            </label>
          </div>
          <div class="extension-add">
            <input v-model="manual.customExtension" placeholder=".sav" @keyup.enter="addCustomExtension" />
            <button type="button" @click="addCustomExtension">Adicionar extensão</button>
          </div>
        </div>
        <button class="primary wide" :disabled="!canAddManual" @click="addManual">Adicionar</button>
      </div>
    </section>
  </div>
</template>
