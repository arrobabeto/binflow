<script setup lang="ts">
import type { Enrollment, UsageResponse } from '@binflow/contracts';

import {
  formatUsdFromCents,
  type AnalyticsDateRange,
} from '../lib/analytics-metrics';
import { visibleDashboardEnrollments } from '../lib/hidden-clients';

const HEY_BINN_MODEL = 'gpt-5.6-luna';

const BINN_RULES = [
  'Read-only advisor — never mutates GitHub, CMS, Vercel, or Shopify.',
  'Loads allowlisted site inventory with truncated blog/page/theme copy into context; LLM has no read/write tools.',
  'Never invokes tools, opens tickets, merges, or publishes.',
  'Suggests enabled tools or /open_ticket; client activates them.',
  'Typed handoff only after explicit in-chat client approval.',
  'No workflow requests for chat v1; usage via binn_usage_events.',
  'Idle thread ends after 10 minutes; also /bye_binn or “Adiós Binn” / “Bye Binn” / “Gracias Binn”.',
] as const;

const BINN_BEHAVIOR_MD = `# Hey Binn behavior

Binn helps clients invent and refine content ideas, then prepare a strong typed
input for an enabled tool. The client starts the tool; Binn does not.

## Ingress

- \`/hey_binn\` (alias \`/hey-binn\`) and greetings that address Binn (Hey Binn, Hola Binn, …).
- Context includes truncated allowlisted site copy (blogs, pages, theme text).
- Does not steal bare courtesy or unrelated tool natural language.

## Model

- Default: \`${HEY_BINN_MODEL}\` via the project OpenAI credential (ADR-0042).

## Handoff

1. Binn may suggest a tool.
2. Client confirms in Telegram.
3. Binn returns a ready-to-paste message.
4. Client runs the tool command themselves.

## End chat

- \`/bye_binn\` or addressed goodbye (\`Adiós Binn\`, \`Bye Binn\`, \`Gracias Binn\`, …).
- Idle thread ends after 10 minutes.

See also \`docs/guides/hey-binn-behavior.md\` and ADR-0062.
`;

const requestFetch = useRequestFetch();

const { data: enrollments } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');

const dateRange = ref<AnalyticsDateRange>('7d');
const dateRangeItems = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'All time', value: 'all' },
] as const;

const {
  data: usage,
  status: usageStatus,
  error: usageError,
} = useAsyncData(
  'binn-ai-usage',
  () =>
    requestFetch<UsageResponse>(
      `/api/v1/usage?range=${encodeURIComponent(dateRange.value)}`,
    ),
  { lazy: true, server: false, watch: [dateRange] },
);

const usagePending = computed(() => usageStatus.value === 'pending');

const heyBinnCapability = computed(() =>
  (usage.value?.byCapability ?? []).find(
    (row) => row.capabilityId === 'hey_binn',
  ),
);

const heyBinnSpendCents = computed(
  () => heyBinnCapability.value?.spendCents ?? 0,
);
const heyBinnCalls = computed(() => heyBinnCapability.value?.modelCalls ?? 0);

const clientNameByProject = computed(() => {
  const map = new Map<string, string>();
  for (const item of visibleDashboardEnrollments(
    enrollments.value?.items ?? [],
  )) {
    map.set(item.projectId, item.tenantKey || item.projectKey);
  }
  return map;
});

const binnClientRows = computed(() =>
  (usage.value?.heyBinnByClient ?? []).map((row) => ({
    ...row,
    name: clientNameByProject.value.get(row.projectId) ?? row.projectId,
  })),
);
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
          Binn AI
        </h1>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Operator view for Hey Binn — the read-only Telegram advisor. Binn never
          starts tools or mutates content. Metrics come from the usage ledger
          only.
        </p>
      </div>
      <USelect
        v-model="dateRange"
        :items="[...dateRangeItems]"
        value-key="value"
        label-key="label"
        class="w-44"
      />
    </div>

    <UAlert
      v-if="usageError"
      class="mb-6"
      color="error"
      title="Could not load usage accounting"
      :description="String(usageError)"
    />

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <UCard class="binflow-surface !ring-0">
        <p class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Chat model
        </p>
        <p class="mt-2 font-mono text-lg text-highlighted">
          {{ HEY_BINN_MODEL }}
        </p>
        <p class="mt-1 text-xs text-muted">Code-owned default · ADR-0062</p>
      </UCard>
      <UCard class="binflow-surface !ring-0">
        <p class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Binn model calls
        </p>
        <p class="mt-2 text-2xl font-semibold text-highlighted">
          {{ usagePending ? '…' : heyBinnCalls }}
        </p>
        <p class="mt-1 text-xs text-muted">
          Capability <code>hey_binn</code>
        </p>
      </UCard>
      <UCard class="binflow-surface !ring-0">
        <p class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Binn estimated spend
        </p>
        <p class="mt-2 text-2xl font-semibold text-highlighted">
          {{ usagePending ? '…' : formatUsdFromCents(heyBinnSpendCents) }}
        </p>
        <p class="mt-1 text-xs text-muted">
          From <code>binn_usage_events</code>
        </p>
      </UCard>
    </div>

    <section class="mt-8">
      <h2 class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        Operator rules
      </h2>
      <ul class="mt-3 space-y-2 text-sm text-highlighted">
        <li v-for="rule in BINN_RULES" :key="rule" class="flex gap-2">
          <span class="text-muted">·</span>
          <span>{{ rule }}</span>
        </li>
      </ul>
    </section>

    <section class="mt-8">
      <h2 class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        Behavior
      </h2>
      <UCard class="binflow-surface mt-3 !ring-0">
        <pre
          class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-highlighted"
          >{{ BINN_BEHAVIOR_MD }}</pre
        >
      </UCard>
    </section>

    <section class="mt-8">
      <h2 class="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        Per-client Binn consumption
      </h2>
      <p class="mt-1 text-xs text-muted">
        Spend and calls attributable only to <code>hey_binn</code> in the
        selected range.
      </p>
      <UCard class="binflow-surface mt-3 !ring-0">
        <p
          v-if="!usagePending && binnClientRows.length === 0"
          class="text-sm text-muted"
        >
          No Binn usage rows in this range.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[28rem] text-left text-sm">
            <thead class="text-muted">
              <tr class="border-b border-[var(--binflow-border)]">
                <th class="pb-3 font-medium">Client</th>
                <th class="pb-3 font-medium">Model calls</th>
                <th class="pb-3 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in binnClientRows"
                :key="row.projectId"
                class="border-b border-[var(--binflow-border)] last:border-0"
              >
                <td class="py-3 text-highlighted">{{ row.name }}</td>
                <td class="py-3">{{ row.modelCalls }}</td>
                <td class="py-3">{{ formatUsdFromCents(row.spendCents) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </section>
  </div>
</template>
