<script setup lang="ts">
import type { AttentionItem } from '../lib/overview-metrics';

defineProps<{
  items: readonly AttentionItem[];
}>();
</script>

<template>
  <div v-if="items.length > 0" class="space-y-3">
    <h2 class="text-xl font-semibold tracking-tight text-white">
      Needs attention
    </h2>
    <UCard
      v-for="item in items"
      :key="item.id"
      class="binflow-surface border-l-4 border-l-warning !ring-0"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="font-medium text-white">{{ item.label }}</p>
          <p class="mt-1 text-sm text-muted">Requires operator follow-up</p>
        </div>
        <UButton :to="item.href" color="warning" variant="soft" size="sm"
          >Open</UButton
        >
      </div>
    </UCard>
  </div>
</template>
