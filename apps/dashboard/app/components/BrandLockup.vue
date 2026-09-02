<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Dark plate lockup from Figma (`lockup-4`); default is transparent crop. */
    plate?: boolean;
  }>(),
  { plate: false },
);
</script>

<template>
  <img
    :src="plate ? '/binflow-lockup-plate.svg' : '/binflow-lockup.svg'"
    alt="Binflow — AI empowering websites"
    class="auth-lockup"
    width="220"
    height="72"
    decoding="async"
  />
</template>
