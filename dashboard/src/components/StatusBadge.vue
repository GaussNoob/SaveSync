<script setup>
import { computed } from 'vue';

const props = defineProps({
  type: { type: String, default: 'neutral' },
  dot: { type: Boolean, default: true }
});

const tone = computed(() => ({
  ok: 'success',
  sync: 'success',
  conflict: 'danger',
  offline: 'danger',
  pending: 'warning',
  platform: 'accent'
}[props.type] || props.type));
</script>

<template>
  <span class="status-badge" :data-tone="tone">
    <span v-if="dot" class="status-badge-dot" aria-hidden="true"></span>
    <slot />
  </span>
</template>
