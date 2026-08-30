<script setup lang="ts">
defineProps<{
  crumbs?: readonly string[];
}>();
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div class="min-w-0">
      <p
        v-if="crumbs?.length"
        class="text-sm text-muted"
      >
        <template v-for="(crumb, index) in crumbs" :key="`${crumb}-${index}`">
          <span v-if="index > 0"> / </span>
          <span :class="index === crumbs.length - 1 ? 'text-white' : ''">{{
            crumb
          }}</span>
        </template>
      </p>
      <slot name="title" />
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
