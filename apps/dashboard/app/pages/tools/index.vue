<script setup lang="ts">
import type { ToolCatalogResponse } from '@binflow/contracts';

import {
  allToolStacks,
  availableToolStacks,
  filterToolCatalog,
  groupToolsByStack,
  toolCatalogSortOptions,
  type ToolCatalogSort,
} from '../../lib/tool-catalog-filter';

const { data, error, pending } = await useFetch<ToolCatalogResponse>(
  '/api/v1/tools',
);

const query = ref('');
const stackFilter = ref(allToolStacks);
const sort = ref<ToolCatalogSort>('stack-asc');

const stackOptions = computed(() => [
  { label: 'All stacks', value: allToolStacks },
  ...availableToolStacks(data.value?.items ?? []).map((stack) => ({
    label: stack,
    value: stack,
  })),
]);

const filteredItems = computed(() =>
  filterToolCatalog(data.value?.items ?? [], {
    query: query.value,
    sort: sort.value,
    stack: stackFilter.value,
  }),
);

const byStack = computed(() => groupToolsByStack(filteredItems.value));
</script>

<template>
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
    <template v-else>
      <div class="mt-8 flex flex-wrap items-end gap-3">
        <UFormField label="Search" class="min-w-56 flex-1">
          <UInput
            v-model="query"
            class="w-full"
            placeholder="Name, id, command, or stack"
            icon="i-lucide-search"
          />
        </UFormField>
        <UFormField label="Stack" class="min-w-44">
          <USelect
            v-model="stackFilter"
            value-key="value"
            :items="stackOptions"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Sort" class="min-w-40">
          <USelect
            v-model="sort"
            value-key="value"
            :items="[...toolCatalogSortOptions]"
            class="w-full"
          />
        </UFormField>
      </div>
      <UCard v-if="filteredItems.length === 0" class="mt-8">
        <p class="font-medium">No tools match</p>
        <p class="mt-1 text-sm text-muted">
          Try another search term or stack filter.
        </p>
      </UCard>
      <div v-else class="mt-8 space-y-10">
        <section v-for="[stack, items] in byStack" :key="stack">
          <h2 class="text-lg font-semibold tracking-tight">{{ stack }}</h2>
          <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UCard v-for="item in items" :key="`${item.id}@${item.version}`">
              <p class="font-semibold">{{ item.displayName }}</p>
              <p class="mt-1 font-mono text-sm text-muted">
                {{ item.id }}@{{ item.version }}
              </p>
              <p class="mt-2 text-sm text-muted">
                /{{ item.command }} · {{ item.nodeCount }} nodes ·
                {{ item.assignedClientCount }} clients · {{ item.riskClass }}
              </p>
              <UButton class="mt-4" :to="`/tools/${item.id}`"
                >Open graph</UButton
              >
            </UCard>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>
