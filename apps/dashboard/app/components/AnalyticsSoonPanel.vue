<script setup lang="ts">
defineProps<{
  description?: string;
  title: string;
}>();
</script>

<template>
  <UCard class="binflow-surface !ring-0">
    <p class="font-semibold text-white">{{ title }}</p>
    <div
      class="mt-6 flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--binflow-border)] bg-[var(--binflow-elevated)]/40 px-4 py-8 text-center"
    >
      <p class="text-sm font-medium text-muted">Available soon</p>
      <p v-if="description" class="mt-2 max-w-sm text-sm text-muted">
        {{ description }}
      </p>
    </div>
  </UCard>
</template>
