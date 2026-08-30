<script setup lang="ts">
import type { ClientSummaryModel } from '../lib/overview-metrics';

defineProps<{
  client: ClientSummaryModel;
}>();

defineEmits<{
  message: [];
}>();

const stateColor = (
  state: string,
): 'success' | 'warning' | 'error' | 'neutral' | 'primary' => {
  if (state === 'active') return 'success';
  if (
    state === 'draft' ||
    state === 'configuring' ||
    state === 'validating' ||
    state === 'ready_for_pairing' ||
    state === 'pairing_pending' ||
    state === 'revalidation_required'
  )
    return 'warning';
  if (state === 'validation_failed' || state === 'suspended') return 'error';
  return 'neutral';
};
</script>

<template>
  <UCard class="binflow-surface !ring-0">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-lg font-semibold text-white">{{ client.label }}</p>
          <UBadge :color="stateColor(client.state)" variant="soft">{{
            client.state
          }}</UBadge>
        </div>
        <p class="mt-1 font-mono text-sm text-[var(--binflow-accent)]">
          Project {{ client.projectKey }}
        </p>
      </div>
      <UButton
        :to="`/clients/${client.id}`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-settings"
        aria-label="Open enrollment settings"
      />
    </div>
    <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div class="binflow-inset px-3 py-2">
        <dt class="text-muted">Requests today</dt>
        <dd class="mt-1 font-semibold text-white">{{ client.requestsToday }}</dd>
      </div>
      <div class="binflow-inset px-3 py-2">
        <dt class="text-muted">Pending approvals</dt>
        <dd class="mt-1 font-semibold text-white">
          {{ client.pendingApprovals }}
        </dd>
      </div>
      <div v-if="client.showEnrollmentStep" class="binflow-inset col-span-2 px-3 py-2">
        <dt class="text-muted">Enrollment step</dt>
        <dd class="mt-1 font-semibold text-white">
          {{ client.currentStep }} of 11
        </dd>
      </div>
    </dl>
    <div class="mt-4 flex flex-wrap gap-2">
      <UButton
        v-if="client.canMessage"
        color="primary"
        variant="soft"
        size="sm"
        @click="$emit('message')"
        >Message</UButton
      >
      <UButton
        :to="`/requests?projectId=${client.projectId}`"
        color="neutral"
        variant="soft"
        size="sm"
        >Requests</UButton
      >
    </div>
  </UCard>
</template>
