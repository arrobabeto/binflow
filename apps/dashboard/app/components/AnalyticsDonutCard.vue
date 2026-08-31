<script setup lang="ts">
import {
  DONUT_COLORS,
  donutGradient,
  formatPercent,
  slicePercent,
  sliceTotal,
  type AnalyticsSlice,
} from '../lib/analytics-metrics';

const props = defineProps<{
  emptyMessage?: string;
  slices: readonly AnalyticsSlice[];
  title: string;
}>();

const total = computed(() => sliceTotal(props.slices));
const gradient = computed(() => donutGradient(props.slices));
</script>

<template>
  <UCard class="binflow-surface !ring-0">
    <div class="flex flex-wrap items-center gap-6">
      <div
        class="relative mx-auto size-40 shrink-0 rounded-full"
        :style="{ background: gradient }"
        role="img"
        :aria-label="`${title} total ${total}`"
      >
        <div
          class="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-[var(--binflow-surface)]"
        >
          <p class="text-[0.65rem] font-semibold tracking-wide text-muted uppercase">
            Total
          </p>
          <p class="font-mono text-lg font-semibold text-white">{{ total }}</p>
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-semibold text-white">{{ title }}</p>
        <p v-if="slices.length === 0" class="mt-4 text-sm text-muted">
          {{ emptyMessage ?? 'No data in the current request batches.' }}
        </p>
        <ul v-else class="mt-4 space-y-2">
          <li
            v-for="(slice, index) in slices"
            :key="slice.label"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{
                  background: DONUT_COLORS[index % DONUT_COLORS.length],
                }"
              />
              <span class="truncate text-white">{{ slice.label }}</span>
            </span>
            <span class="shrink-0 font-mono text-[var(--binflow-accent)]">
              {{ formatPercent(slicePercent(slices, index)) }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </UCard>
</template>
