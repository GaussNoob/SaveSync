<script setup>
defineProps({
  icon: { type: [Object, Function], default: null },
  title: { type: String, required: true },
  description: { type: String, required: true },
  compact: Boolean
});
</script>

<template>
  <div class="empty-state" :class="{ 'empty-state-compact': compact }">
    <span v-if="icon" class="empty-icon" aria-hidden="true">
      <component :is="icon" :size="18" :stroke-width="1.6" />
    </span>
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <div v-if="$slots.action" class="empty-action">
      <slot name="action" />
    </div>
  </div>
</template>
