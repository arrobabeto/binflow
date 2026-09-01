<script setup lang="ts">
import {
  requestCardAccentClass,
  type RequestStateAccent,
} from '../lib/request-inbox';

const props = withDefaults(
  defineProps<{
    label: string;
    value: string;
    detail?: string;
    to?: string;
    accent?: RequestStateAccent;
  }>(),
  { accent: 'neutral' },
);

const cardClass = computed(() => requestCardAccentClass(props.accent));

const valueClass = computed(() => {
  if (props.accent === 'success') return 'text-emerald-400';
  if (props.accent === 'warning') return 'text-amber-400';
  if (props.accent === 'error') return 'text-rose-400';
  return 'text-white';
});
</script>

<template>
  <UCard :class="['binflow-surface !ring-0', cardClass]">
    <p class="text-xs font-medium tracking-wide text-muted uppercase">
      {{ label }}
    </p>
    <p
      class="mt-3 text-2xl font-semibold tracking-tight"
      :class="valueClass"
    >
      {{ value || '—' }}
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
