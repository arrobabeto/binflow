<script setup lang="ts">
import type { Enrollment } from '@binflow/contracts';

const { data, refresh, status } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');

const stateColor = (
  state: Enrollment['state'],
): 'success' | 'warning' | 'error' | 'neutral' => {
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
  <main class="mx-auto max-w-6xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Clients']">
      <template #title>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
          Client enrollments
        </h1>
        <p class="mt-2 text-muted">
          Resume configuration and see activation readiness.
        </p>
      </template>
      <template #actions>
        <UButton
          color="neutral"
          variant="soft"
          :loading="status === 'pending'"
          @click="refresh"
          >Refresh</UButton
        >
        <UButton to="/clients/new">Add client</UButton>
      </template>
    </PageHeader>
    <div class="grid gap-4">
      <UCard v-if="data?.items.length === 0" class="binflow-surface !ring-0">
        <p class="font-medium text-white">No clients yet</p>
        <p class="mt-1 text-sm text-muted">
          Create the first enrollment or adopt the existing Phase 0 scope.
        </p>
      </UCard>
      <UCard
        v-for="item in data?.items ?? []"
        :key="item.id"
        class="binflow-surface !ring-0"
      >
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <p class="text-lg font-semibold text-white">{{ item.tenantKey }}</p>
              <UBadge :color="stateColor(item.state)" variant="soft">{{
                item.state
              }}</UBadge>
            </div>
            <p class="mt-1 font-mono text-sm text-[var(--binflow-accent)]">
              Project {{ item.projectKey }} · Step {{ item.currentStep }} of 11
            </p>
          </div>
          <UButton
            :to="`/clients/${item.id}`"
            color="neutral"
            variant="soft"
            >Open enrollment</UButton
          >
        </div>
      </UCard>
    </div>
  </main>
</template>
