<script setup>
defineProps({
  width: { type: String, default: '100%' },
  height: { type: String, default: '12px' },
  radius: { type: String, default: '6px' }
});
</script>

<template>
  <span
    class="skeleton-block"
    :style="{ width, height, borderRadius: radius }"
    aria-hidden="true"
  />
</template>
