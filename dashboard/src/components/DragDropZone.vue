<script setup>
const emit = defineEmits(['path']);

function onDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  const path = file?.path || file?.webkitRelativePath || '';
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
    <strong>Arraste uma pasta de saves aqui</strong>
    <span>Ou use o seletor nativo no app Electron.</span>
    <button class="outline" type="button" @click="selectFolder">Selecionar pasta</button>
  </div>
</template>
