<script setup>
import {
  TooltipContent,
  TooltipPortal,
  TooltipRoot,
  TooltipTrigger
} from 'radix-vue';

defineProps({
  text: { type: String, required: true },
  side: { type: String, default: 'bottom' }
});
</script>

<template>
  <TooltipRoot :delay-duration="350">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="tooltip-content" :side="side" :side-offset="7">
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
