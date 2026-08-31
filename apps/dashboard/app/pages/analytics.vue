<script setup lang="ts">
import type {
  Enrollment,
  RequestSummary,
  ToolCatalogResponse,
  ToolGraphResponse,
} from '@binflow/contracts';

import {
  aggregateFailedRequestsByCapability,
  aggregateModelsFromGraphs,
  aggregateRequestsByCapability,
  analyticsRangeDetail,
  buildClientCostRows,
  buildToolUsageRows,
  fetchAllRequestSummaries,
  filterRequestsByDateRange,
  formatPercent,
  type AnalyticsDateRange,
} from '../lib/analytics-metrics';
import {
  formatApproximateCount,
  type ApproximateCount,
} from '../lib/overview-metrics';
import { analyticsRequestListSearchParams } from '../lib/request-inbox';

const requestFetch = useRequestFetch();

const { data: tools } = await useFetch<ToolCatalogResponse>('/api/v1/tools');
const { data: enrollments } = await useFetch<{
  items: Enrollment[];
  nextCursor: string | null;
}>('/api/v1/admin/enrollments');

const {
  data: requestCatalog,
  status: requestsStatus,
  error: requestsError,
} = await useAsyncData('analytics-all-requests', () =>
  fetchAllRequestSummaries(async ({ cursor, limit }) =>
    requestFetch<{ items: RequestSummary[]; nextCursor: string | null }>(
      `/api/v1/requests?${analyticsRequestListSearchParams({
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })}`,
    ),
  ),
);

const dateRange = ref<AnalyticsDateRange>('7d');
const dateRangeItems = [
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'All time', value: 'all' },
] as const;

const loadedRequests = computed(() => requestCatalog.value?.items ?? []);
const requestsTruncated = computed(
  () => requestCatalog.value?.truncated === true,
);

const rangedRequests = computed(() =>
  filterRequestsByDateRange(loadedRequests.value, dateRange.value),
);

const totalRequests = computed((): ApproximateCount => ({
  approximate: requestsTruncated.value,
  value: rangedRequests.value.length,
}));

const rangeDetail = computed(() => analyticsRangeDetail(dateRange.value));

const toolItems = computed(() => tools.value?.items ?? []);

const usageSlices = computed(() =>
  aggregateRequestsByCapability(rangedRequests.value, toolItems.value),
);
const failureSlices = computed(() =>
  aggregateFailedRequestsByCapability(rangedRequests.value, toolItems.value),
);
const usageRows = computed(() =>
  buildToolUsageRows(rangedRequests.value, toolItems.value),
);
const clientRows = computed(() =>
  buildClientCostRows(enrollments.value?.items ?? []),
);

const { data: graphs, status: graphsStatus } = await useAsyncData(
  'analytics-tool-graphs',
  async () => {
    const items = tools.value?.items ?? [];
    if (items.length === 0) return [] as ToolGraphResponse[];
    return Promise.all(
      items.map((tool) =>
        requestFetch<ToolGraphResponse>(`/api/v1/tools/${tool.id}/graph`),
      ),
    );
  },
  { watch: [toolItems] },
);

const modelSlices = computed(() =>
  aggregateModelsFromGraphs(graphs.value ?? []),
);
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-8 lg:px-8">
    <PageHeader :crumbs="['Analytics']">
      <template #title>
        <h1 class="mt-1 text-3xl font-semibold tracking-tight text-white">
          Analytics
        </h1>
        <p class="mt-2 text-muted">
          Operational metrics from live requests and tool graphs. Cost and
          latency panels wait on usage accounting.
        </p>
      </template>
      <template #actions>
        <UFormField label="Range" class="min-w-40">
          <USelect
            v-model="dateRange"
            value-key="value"
            :items="[...dateRangeItems]"
          />
        </UFormField>
      </template>
    </PageHeader>
    <p class="mb-6 -mt-2 text-xs text-muted">
      Request metrics use {{ rangeDetail.toLowerCase() }} (exact count from the
      full request list, filtered by created time). Cost panels stay Available
      soon.
    </p>
    <UAlert
      v-if="requestsError"
      class="mb-6"
      color="error"
      title="Could not load requests for analytics"
      :description="String(requestsError)"
    />
    <p v-else-if="requestsStatus === 'pending'" class="mb-6 text-sm text-muted">
      Loading all requests for exact range totals…
    </p>

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <AnalyticsKpiCard label="Total API Spend" soon />
      <AnalyticsKpiCard
        label="Total Requests"
        :value="
          requestsStatus === 'pending'
            ? '…'
            : formatApproximateCount(totalRequests)
        "
        :detail="
          totalRequests.approximate
            ? `${rangeDetail} · catalog truncated at page cap`
            : rangeDetail
        "
      />
      <AnalyticsKpiCard label="Avg Cost/Request" soon />
      <AnalyticsKpiCard label="Avg Latency" soon />
    </div>

    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      <AnalyticsDonutCard
        title="Tool Usage"
        :slices="usageSlices"
        empty-message="No requests in the selected range."
      />
      <AnalyticsDonutCard
        title="Tool Failures"
        :slices="failureSlices"
        empty-message="No failed requests in the selected range."
      />
    </div>

    <section class="mt-8">
      <h2
        class="text-xs font-semibold tracking-[0.14em] text-muted uppercase"
      >
        Tool usage &amp; success rate
      </h2>
      <UCard class="binflow-surface mt-3 !ring-0">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[40rem] text-left text-sm">
            <thead class="text-muted">
              <tr class="border-b border-[var(--binflow-border)]">
                <th class="pb-3 font-medium">Tool Name</th>
                <th class="pb-3 font-medium">Total Calls</th>
                <th class="pb-3 font-medium">Success Rate</th>
                <th class="pb-3 font-medium">Failed Calls</th>
                <th class="pb-3 font-medium">Avg Execution Time</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="usageRows.length === 0">
                <td colspan="5" class="py-6 text-muted">
                  No tool calls in the selected range.
                </td>
              </tr>
              <tr
                v-for="row in usageRows"
                :key="row.toolName"
                class="border-b border-[var(--binflow-border)] last:border-b-0"
              >
                <td class="py-3 font-medium text-white">{{ row.toolName }}</td>
                <td class="py-3 font-mono text-[var(--binflow-accent)]">
                  {{ row.totalCalls }}
                </td>
                <td class="py-3">
                  <div class="flex items-center gap-2">
                    <div
                      class="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--binflow-elevated)]"
                    >
                      <div
                        class="h-full rounded-full bg-emerald-500"
                        :style="{
                          width: `${String(Math.min(100, row.successRate ?? 0))}%`,
                        }"
                      />
                    </div>
                    <span class="font-mono text-sm text-white">{{
                      formatPercent(row.successRate)
                    }}</span>
                  </div>
                </td>
                <td class="py-3 font-mono text-white">{{ row.failedCalls }}</td>
                <td class="py-3 text-muted">Available soon</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </section>

    <div class="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <AnalyticsSoonPanel
        title="API Cost Over Time"
        description="Daily spend series requires GET /api/v1/usage."
      />
      <AnalyticsDonutCard
        title="Requests by Model"
        :slices="modelSlices"
        :empty-message="
          graphsStatus === 'pending'
            ? 'Loading tool graphs…'
            : 'No agent models found on tool graphs.'
        "
      />
    </div>
    <p class="mt-2 text-xs text-muted">
      Model mix is counted from configured agent nodes on tool graphs, not
      runtime request volume.
    </p>

    <section class="mt-8">
      <h2
        class="text-xs font-semibold tracking-[0.14em] text-muted uppercase"
      >
        Cost by client
      </h2>
      <UCard class="binflow-surface mt-3 !ring-0">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[36rem] text-left text-sm">
            <thead class="text-muted">
              <tr class="border-b border-[var(--binflow-border)]">
                <th class="pb-3 font-medium">Client</th>
                <th class="pb-3 font-medium">Status</th>
                <th class="pb-3 font-medium">Budget Utilization</th>
                <th class="pb-3 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="clientRows.length === 0">
                <td colspan="4" class="py-6 text-muted">No enrollments yet.</td>
              </tr>
              <tr
                v-for="row in clientRows"
                :key="`${row.label}-${row.state}`"
                class="border-b border-[var(--binflow-border)] last:border-b-0"
              >
                <td class="py-3 font-medium text-white">{{ row.label }}</td>
                <td class="py-3">
                  <UBadge
                    :color="
                      row.state === 'active'
                        ? 'success'
                        : row.state === 'suspended'
                          ? 'error'
                          : 'warning'
                    "
                    variant="soft"
                    >{{ row.state }}</UBadge
                  >
                </td>
                <td class="py-3 text-muted">Available soon</td>
                <td class="py-3 text-muted">Available soon</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </section>

    <div class="mt-6 grid gap-4 lg:grid-cols-2">
      <AnalyticsSoonPanel
        title="Recent Cost Alerts"
        description="Budget and anomaly alerts require usage monitoring."
      />
      <AnalyticsSoonPanel
        title="Model Efficiency Index"
        description="Token cost scores are not published until pricing snapshots are exposed."
      />
    </div>
  </main>
</template>
