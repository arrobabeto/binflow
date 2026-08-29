<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  detail?: string;
  to?: string;
}>();
</script>

<template>
  <UCard>
    <p class="text-sm text-muted">{{ label }}</p>
    <p class="mt-2 text-xl font-semibold tracking-tight">{{ value }}</p>
    <p v-if="detail" class="mt-1 text-sm text-muted">{{ detail }}</p>
    <UButton
      v-if="to"
      class="mt-3"
      :to="to"
      color="neutral"
      variant="soft"
      size="sm"
      >Open</UButton
    >
  </UCard>
</template>
