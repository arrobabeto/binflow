<script setup lang="ts">
import type { AttentionItem } from '../lib/overview-metrics';

defineProps<{
  items: readonly AttentionItem[];
}>();
</script>

<template>
  <UCard v-if="items.length > 0">
    <p class="font-semibold">Needs attention</p>
    <ul class="mt-3 space-y-2">
      <li v-for="item in items" :key="item.id">
        <NuxtLink
          :to="item.href"
          class="text-sm font-medium text-primary hover:underline"
          >{{ item.label }}</NuxtLink
        >
      </li>
    </ul>
  </UCard>
</template>
