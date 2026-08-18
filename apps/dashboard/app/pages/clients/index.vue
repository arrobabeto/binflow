<script setup lang="ts">
import type { Enrollment } from '@binflow/contracts';

const { data, refresh, status } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-white">
      <div
        class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
      >
        <div>
          <p class="eyebrow">Binflow</p>
          <p class="font-semibold">Clients</p>
        </div>
        <div class="flex gap-2">
          <UButton color="neutral" variant="ghost" to="/">Overview</UButton>
          <UButton to="/clients/new">Add client</UButton>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-6 py-10">
      <div class="flex items-end justify-between">
        <div>
          <h1 class="text-3xl font-semibold tracking-tight">
            Client enrollments
          </h1>
          <p class="mt-2 text-muted">
            Resume configuration and see activation readiness.
          </p>
        </div>
        <UButton
          color="neutral"
          variant="soft"
          :loading="status === 'pending'"
          @click="refresh"
          >Refresh</UButton
        >
      </div>
      <div class="mt-8 grid gap-4">
        <UCard v-if="data?.items.length === 0">
          <p class="font-medium">No clients yet</p>
          <p class="mt-1 text-sm text-muted">
            Create the first enrollment or adopt the existing Phase 0 scope.
          </p>
        </UCard>
        <UCard v-for="item in data?.items ?? []" :key="item.id">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <p class="text-lg font-semibold">{{ item.tenantKey }}</p>
                <UBadge color="neutral" variant="soft">{{ item.state }}</UBadge>
              </div>
              <p class="mt-1 text-sm text-muted">
                Project {{ item.projectKey }} · Step {{ item.currentStep }} of
                11
              </p>
            </div>
            <UButton
              :to="`/clients/${item.id}`"
              color="neutral"
              variant="outline"
              >Open enrollment</UButton
            >
          </div>
        </UCard>
      </div>
    </main>
  </div>
</template>
