<script setup>
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle
} from 'radix-vue';

defineProps({
  open: Boolean,
  title: { type: String, required: true },
  description: { type: String, required: true },
  confirmLabel: { type: String, default: 'Confirmar' },
  cancelLabel: { type: String, default: 'Cancelar' },
  tone: { type: String, default: 'danger' },
  busy: Boolean
});

defineEmits(['update:open', 'confirm']);
</script>

<template>
  <AlertDialogRoot :open="open" @update:open="$emit('update:open', $event)">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay" />
      <AlertDialogContent class="confirm-dialog">
        <AlertDialogTitle class="dialog-title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="dialog-description">
          {{ description }}
        </AlertDialogDescription>
        <div class="dialog-actions">
          <AlertDialogCancel as-child>
            <button class="button button-secondary" :disabled="busy">{{ cancelLabel }}</button>
          </AlertDialogCancel>
          <AlertDialogAction as-child>
            <button
              class="button"
              :class="tone === 'danger' ? 'button-danger' : 'button-primary'"
              :disabled="busy"
              @click="$emit('confirm')"
            >
              {{ busy ? 'Processando…' : confirmLabel }}
            </button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
