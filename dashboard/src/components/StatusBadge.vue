<script setup>
defineProps({
  type: { type: String, default: 'platform' }
});
</script>

<template>
  <span class="badge" :class="`badge-${type}`"><slot /></span>
</template>
