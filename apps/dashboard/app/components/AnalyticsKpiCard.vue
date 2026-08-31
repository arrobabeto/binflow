<script setup lang="ts">
defineProps<{
  detail?: string;
  label: string;
  soon?: boolean;
  value?: string;
}>();
</script>

<template>
  <UCard class="binflow-surface !ring-0">
    <p class="text-xs font-medium tracking-wide text-muted uppercase">
      {{ label }}
    </p>
    <template v-if="soon">
      <p class="mt-3 text-lg font-semibold text-muted">Available soon</p>
      <p class="mt-1 text-sm text-muted">
        Requires usage accounting that is not wired yet.
      </p>
    </template>
    <template v-else>
      <p class="mt-3 text-2xl font-semibold tracking-tight text-white">
        {{ value }}
      </p>
      <p v-if="detail" class="mt-1 text-sm text-muted">{{ detail }}</p>
    </template>
  </UCard>
</template>
