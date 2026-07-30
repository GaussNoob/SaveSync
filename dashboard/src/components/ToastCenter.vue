<script setup>
import {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport
} from 'radix-vue';
import { AlertTriangle, CheckCircle2, Info, X } from '@lucide/vue';
import { useUiStore } from '../stores/ui.js';

const ui = useUiStore();

const toneIcon = {
  success: CheckCircle2,
  error: AlertTriangle,
  warning: AlertTriangle,
  info: Info
};
</script>

<template>
  <ToastProvider swipe-direction="right">
    <ToastRoot
      v-for="notification in ui.notifications"
      :key="notification.id"
      :open="true"
      :duration="notification.duration"
      class="toast-root"
      :data-tone="notification.tone"
      @update:open="open => !open && ui.dismiss(notification.id)"
    >
      <component :is="toneIcon[notification.tone] || Info" :size="17" aria-hidden="true" />
      <div class="toast-copy">
        <ToastTitle class="toast-title">{{ notification.title }}</ToastTitle>
        <ToastDescription v-if="notification.description" class="toast-description">
          {{ notification.description }}
        </ToastDescription>
      </div>
      <ToastClose class="icon-button toast-close" aria-label="Fechar notificação">
        <X :size="15" />
      </ToastClose>
    </ToastRoot>
    <ToastViewport class="toast-viewport" />
  </ToastProvider>
</template>
