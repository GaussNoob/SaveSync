<script setup>
import { FolderOpen, FolderUp } from '@lucide/vue';

const emit = defineEmits(['path']);
const desktopFolderAccess = Boolean(window.saveSync?.selectFolder && window.saveSync?.getPathForFile);

function onDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  const path = file && window.saveSync?.getPathForFile
    ? window.saveSync.getPathForFile(file)
    : file?.path || '';
  if (path) emit('path', path);
}

async function selectFolder() {
  if (!window.saveSync?.selectFolder) return;
  const path = await window.saveSync.selectFolder();
  if (path) emit('path', path);
}
</script>

<template>
  <div class="drop-zone" @dragover.prevent @drop="onDrop">
    <span class="drop-zone-icon"><FolderUp :size="18" :stroke-width="1.6" /></span>
    <strong>{{ desktopFolderAccess ? 'Solte uma pasta de saves' : 'Seleção disponível no aplicativo desktop' }}</strong>
    <span>
      {{ desktopFolderAccess
        ? 'O caminho será analisado localmente para identificar o jogo e as extensões.'
        : 'No navegador, informe o caminho que existe no servidor pela aba Manual.' }}
    </span>
    <button v-if="desktopFolderAccess" class="button button-secondary" type="button" @click="selectFolder">
      <FolderOpen :size="14" />
      Selecionar pasta
    </button>
  </div>
</template>
