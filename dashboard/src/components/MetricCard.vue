<script setup>
defineProps({
  label: String,
  value: [String, Number],
  tone: { type: String, default: 'purple' },
  sublabel: String
});
</script>

<template>
  <article class="metric">
    <span>{{ label }}</span>
    <strong :class="`value-${tone}`">{{ value }}</strong>
    <small>{{ sublabel }}</small>
  </article>
</template>
