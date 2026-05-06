<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';

const conflicts = ref([]);

async function load() {
  conflicts.value = await api('/conflicts');
}

async function resolve(conflict, resolution) {
  await api(`/conflicts/${conflict.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution })
  });
  await load();
}

onMounted(load);
</script>

<template>
  <section class="view">
    <div class="view-actions">
      <button @click="load">Atualizar</button>
    </div>

    <section class="panel">
      <div v-if="!conflicts.length" class="empty">Nenhum conflito aberto.</div>
      <article v-for="conflict in conflicts" :key="conflict.id" class="conflict-block">
        <div class="section-title">
          <p>{{ conflict.game_id || 'Jogo não identificado' }}</p>
          <span class="badge badge-conflict">Conflito</span>
        </div>
        <div class="conflict-compare">
          <div class="conflict-version">
            <h2>Versão local</h2>
            <dl>
              <dt>Dispositivo</dt><dd>Local</dd>
              <dt>Timestamp</dt><dd><code>{{ conflict.created_at }}</code></dd>
              <dt>Tamanho</dt><dd>Arquivo atual</dd>
              <dt>Caminho</dt><dd><code>{{ conflict.original_path }}</code></dd>
            </dl>
            <button class="danger-outline" @click="resolve(conflict, 'use-local')">Usar esta versão</button>
          </div>
          <div class="conflict-version">
            <h2>Versão em quarentena</h2>
            <dl>
              <dt>Dispositivo</dt><dd>Remoto</dd>
              <dt>Timestamp</dt><dd><code>{{ conflict.metadata?.mtime || conflict.created_at }}</code></dd>
              <dt>Tamanho</dt><dd>{{ conflict.metadata?.size || 0 }} bytes</dd>
              <dt>Caminho</dt><dd><code>{{ conflict.quarantine_path }}</code></dd>
            </dl>
            <button class="danger-outline" @click="resolve(conflict, 'use-quarantine')">Usar esta versão</button>
          </div>
        </div>
      </article>
    </section>
  </section>
</template>
