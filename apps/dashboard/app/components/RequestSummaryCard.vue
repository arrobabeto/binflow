<script setup lang="ts">
import type { RequestSummary } from '@binflow/contracts';

import {
  requestStateAccent,
  requestStateAccentTextClass,
  requestStateBadgeColor,
} from '../lib/request-inbox';

const props = defineProps<{
  item: RequestSummary;
}>();

const accent = computed(() => requestStateAccent(props.item.state));
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <p
        class="text-xs font-medium tracking-wide uppercase"
        :class="requestStateAccentTextClass(accent)"
      >
        {{ item.clientName }}
      </p>
      <p class="mt-1 font-semibold text-white">
        {{ item.topic ?? 'No topic' }}
      </p>
      <p class="mt-1 font-mono text-sm text-[var(--binflow-accent)]">
        {{ item.capabilityId }} · version {{ item.currentVersion }}
      </p>
    </div>
    <div class="flex shrink-0 flex-col items-center gap-[13px]">
      <UBadge
        class="justify-center"
        :color="requestStateBadgeColor(item.state)"
        variant="soft"
        >{{ item.state }}</UBadge
      >
      <UButton
        :to="`/requests/${item.id}`"
        color="neutral"
        variant="soft"
        >Open request</UButton
      >
    </div>
  </div>
</template>
