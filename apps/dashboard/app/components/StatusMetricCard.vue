<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  detail?: string;
  to?: string;
}>();
</script>

<template>
  <UCard class="binflow-surface !ring-0">
    <p class="text-xs font-medium tracking-wide text-muted uppercase">
      {{ label }}
    </p>
    <p class="mt-3 text-2xl font-semibold tracking-tight text-white">
      {{ value }}
    </p>
    <p v-if="detail" class="mt-1 text-sm text-muted">{{ detail }}</p>
    <UButton
      v-if="to"
      class="mt-4"
      :to="to"
      color="neutral"
      variant="soft"
      size="sm"
      >Open</UButton
    >
  </UCard>
</template>
