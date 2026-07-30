<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  detail: { type: String, default: '' },
  icon: { type: [Object, Function], default: null },
  tone: { type: String, default: 'neutral' }
});
</script>

<template>
  <article class="metric-card panel" :data-tone="tone">
    <div class="metric-card-head">
      <span>{{ label }}</span>
      <component v-if="icon" :is="icon" :size="15" :stroke-width="1.6" aria-hidden="true" />
    </div>
    <strong>{{ value }}</strong>
    <small>{{ detail }}</small>
  </article>
</template>
