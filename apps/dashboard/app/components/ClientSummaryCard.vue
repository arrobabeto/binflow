<script setup lang="ts">
import type { ClientSummaryModel } from '../lib/overview-metrics';

defineProps<{
  client: ClientSummaryModel;
}>();
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-lg font-semibold">{{ client.label }}</p>
          <UBadge color="neutral" variant="soft">{{ client.state }}</UBadge>
        </div>
        <p class="mt-1 text-sm text-muted">Project {{ client.projectKey }}</p>
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
      <div>
        <dt class="text-muted">Requests today</dt>
        <dd class="font-medium">{{ client.requestsToday }}</dd>
      </div>
      <div>
        <dt class="text-muted">Pending approvals</dt>
        <dd class="font-medium">{{ client.pendingApprovals }}</dd>
      </div>
      <div v-if="client.showEnrollmentStep" class="col-span-2">
        <dt class="text-muted">Enrollment step</dt>
        <dd class="font-medium">{{ client.currentStep }} of 11</dd>
      </div>
    </dl>
    <div class="mt-4">
      <UButton
        :to="`/requests?projectId=${client.projectId}`"
        color="neutral"
        variant="ghost"
        size="sm"
        >Requests</UButton
      >
    </div>
  </UCard>
</template>
