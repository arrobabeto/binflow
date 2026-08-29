<script setup lang="ts">
import type { ToolCatalogResponse } from '@binflow/contracts';

const { data, error, pending } = await useFetch<ToolCatalogResponse>(
  '/api/v1/tools',
);

const byStack = computed(() => {
  const groups = new Map<string, NonNullable<typeof data.value>['items']>();
  for (const item of data.value?.items ?? []) {
    const current = groups.get(item.stack) ?? [];
    current.push(item);
    groups.set(item.stack, current);
  }
  return [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
});
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-white">
      <div
        class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"
      >
        <div>
          <p class="eyebrow">Binflow</p>
          <p class="font-semibold">Tools</p>
        </div>
        <div class="flex items-center gap-3">
          <UButton to="/" color="neutral" variant="soft">Overview</UButton>
          <UButton to="/clients" color="neutral" variant="soft"
            >Clients</UButton
          >
          <UButton to="/customizations" color="neutral" variant="soft"
            >Customizations</UButton
          >
          <UButton to="/requests" color="neutral" variant="soft"
            >Requests</UButton
          >
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-6 py-10">
      <h1 class="text-3xl font-semibold tracking-tight">Tools by stack</h1>
      <p class="mt-2 text-muted">
        Code-owned capabilities grouped by technical profile. Open a tool to
        inspect its graph, rules and model settings.
      </p>
      <p v-if="pending" class="mt-8 text-muted">Loading tools…</p>
      <UAlert
        v-else-if="error"
        class="mt-8"
        color="error"
        title="Could not load tools"
        :description="String(error)"
      />
      <div v-else class="mt-10 space-y-10">
        <section v-for="[stack, items] in byStack" :key="stack">
          <h2 class="text-xl font-semibold">{{ stack }}</h2>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <UCard v-for="item in items" :key="`${item.id}@${item.version}`">
              <p class="font-semibold">{{ item.displayName }}</p>
              <p class="mt-1 font-mono text-sm text-muted">
                {{ item.id }}@{{ item.version }}
              </p>
              <p class="mt-3 text-sm text-muted">
                {{ item.command }} · {{ item.nodeCount }} nodes ·
                {{ item.assignedClientCount }} clients · {{ item.riskClass }}
              </p>
              <UButton class="mt-4" :to="`/tools/${item.id}`"
                >Open graph</UButton
              >
            </UCard>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
