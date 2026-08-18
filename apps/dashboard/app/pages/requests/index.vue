<script setup lang="ts">
import type { RequestSummary } from '@binflow/contracts';

const { data, refresh, status } = await useFetch<{
  items: RequestSummary[];
  nextCursor: string | null;
}>('/api/v1/requests');
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-white">
      <div
        class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
      >
        <div>
          <p class="eyebrow">Binflow</p>
          <p class="font-semibold">Requests</p>
        </div>
        <div class="flex gap-2">
          <UButton color="neutral" variant="ghost" to="/">Overview</UButton>
          <UButton color="neutral" variant="ghost" to="/clients"
            >Clients</UButton
          >
          <UButton
            color="neutral"
            variant="soft"
            :loading="status === 'pending'"
            @click="refresh"
            >Refresh</UButton
          >
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-6 py-10">
      <h1 class="text-3xl font-semibold tracking-tight">Workflow requests</h1>
      <p class="mt-2 text-muted">
        Durable client requests and their current safe state.
      </p>
      <div class="mt-8 grid gap-4">
        <UCard v-if="data?.items.length === 0">
          <p class="font-medium">No requests yet</p>
          <p class="mt-1 text-sm text-muted">
            Paired clients can begin with /create_blog.
          </p>
        </UCard>
        <UCard v-for="item in data?.items ?? []" :key="item.id">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2">
                <p class="font-semibold">{{ item.topic ?? 'No topic' }}</p>
                <UBadge color="neutral" variant="soft">{{ item.state }}</UBadge>
              </div>
              <p class="mt-1 text-sm text-muted">
                {{ item.capabilityId }} · version {{ item.currentVersion }}
              </p>
            </div>
            <UButton
              :to="`/requests/${item.id}`"
              color="neutral"
              variant="outline"
              >Open request</UButton
            >
          </div>
        </UCard>
      </div>
    </main>
  </div>
</template>
