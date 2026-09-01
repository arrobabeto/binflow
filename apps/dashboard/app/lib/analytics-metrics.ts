import type {
  Enrollment,
  RequestSummary,
  ToolCatalogItem,
  ToolGraphResponse,
} from '@binflow/contracts';

import { formatClientKeyLabel } from './request-inbox';

export type AnalyticsSlice = Readonly<{
  label: string;
  value: number;
}>;

export type ToolUsageRow = Readonly<{
  avgExecutionMs: number | null;
  capabilityId: string;
  failedCalls: number;
  successRate: number | null;
  toolName: string;
  totalCalls: number;
}>;

export type ClientCostRow = Readonly<{
  budgetUtilizationPercent: number | null;
  label: string;
  projectId: string;
  spendCents: number | null;
  state: Enrollment['state'];
}>;

export type AnalyticsDateRange = '24h' | '7d' | '30d' | 'all';

const failedStates = new Set<RequestSummary['state']>([
  'FAILED_FINAL',
  'FAILED_RETRYABLE',
]);

/** Inclusive lower bound for createdAt when filtering analytics request batches. */
export const analyticsRangeStart = (
  range: AnalyticsDateRange,
  now: Date = new Date(),
): Date | null => {
  if (range === 'all') return null;
  if (range === '24h') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (range === '7d' ? 6 : 29));
  return start;
};

export const filterRequestsByDateRange = <
  T extends Pick<RequestSummary, 'createdAt'>,
>(
  requests: readonly T[],
  range: AnalyticsDateRange,
  now: Date = new Date(),
): readonly T[] => {
  const start = analyticsRangeStart(range, now);
  if (start === null) return requests;
  const startMs = start.getTime();
  return requests.filter((request) => {
    const created = Date.parse(request.createdAt);
    return Number.isFinite(created) && created >= startMs;
  });
};

export const analyticsRangeDetail = (range: AnalyticsDateRange): string => {
  if (range === '24h') return 'Last 24 hours';
  if (range === '7d') return 'Last 7 days (UTC)';
  if (range === '30d') return 'Last 30 days (UTC)';
  return 'All requests';
};

export const ANALYTICS_REQUEST_PAGE_LIMIT = 50 as const;
export const ANALYTICS_REQUEST_MAX_PAGES = 200 as const;

export type AnalyticsRequestPage = Readonly<{
  items: readonly RequestSummary[];
  nextCursor: string | null;
}>;

/**
 * Walks opaque request-list cursors until exhausted (or max pages) so Analytics
 * can filter by createdAt with exact counts instead of a single 50-item batch.
 */
export const fetchAllRequestSummaries = async (
  fetchPage: (input: {
    cursor?: string;
    limit: typeof ANALYTICS_REQUEST_PAGE_LIMIT;
  }) => Promise<AnalyticsRequestPage>,
): Promise<{ items: RequestSummary[]; truncated: boolean }> => {
  const items: RequestSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < ANALYTICS_REQUEST_MAX_PAGES; page += 1) {
    const result = await fetchPage({
      ...(cursor === undefined ? {} : { cursor }),
      limit: ANALYTICS_REQUEST_PAGE_LIMIT,
    });
    items.push(...result.items);
    if (result.nextCursor === null || result.nextCursor === '') {
      return { items, truncated: false };
    }
    cursor = result.nextCursor;
  }
  return { items, truncated: true };
};

export const DONUT_COLORS = [
  '#3b82f6',
  '#22d3ee',
  '#10b981',
  '#f59e0b',
  '#a78bfa',
  '#f97316',
  '#ef4444',
  '#64748b',
] as const;

export const aggregateRequestsByCapability = (
  requests: readonly Pick<RequestSummary, 'capabilityId'>[],
  tools: readonly Pick<ToolCatalogItem, 'displayName' | 'id'>[],
): readonly AnalyticsSlice[] => {
  const labels = new Map(tools.map((tool) => [tool.id, tool.displayName]));
  const counts = new Map<string, number>();
  for (const request of requests) {
    counts.set(
      request.capabilityId,
      (counts.get(request.capabilityId) ?? 0) + 1,
    );
  }
  return [...counts.entries()]
    .map(([id, value]) => ({
      label: labels.get(id) ?? id,
      value,
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
};

export const aggregateFailedRequestsByCapability = (
  requests: readonly Pick<RequestSummary, 'capabilityId' | 'state'>[],
  tools: readonly Pick<ToolCatalogItem, 'displayName' | 'id'>[],
): readonly AnalyticsSlice[] =>
  aggregateRequestsByCapability(
    requests.filter((request) => failedStates.has(request.state)),
    tools,
  );

export const buildToolUsageRows = (
  requests: readonly Pick<RequestSummary, 'capabilityId' | 'state'>[],
  tools: readonly Pick<ToolCatalogItem, 'displayName' | 'id'>[],
  avgLatencyByCapability: ReadonlyMap<string, number | null> = new Map(),
): readonly ToolUsageRow[] => {
  const labels = new Map(tools.map((tool) => [tool.id, tool.displayName]));
  const totals = new Map<string, { failed: number; total: number }>();
  for (const request of requests) {
    const current = totals.get(request.capabilityId) ?? {
      failed: 0,
      total: 0,
    };
    current.total += 1;
    if (failedStates.has(request.state)) current.failed += 1;
    totals.set(request.capabilityId, current);
  }
  return [...totals.entries()]
    .map(([id, counts]) => ({
      avgExecutionMs: avgLatencyByCapability.get(id) ?? null,
      capabilityId: id,
      failedCalls: counts.failed,
      successRate:
        counts.total === 0
          ? null
          : ((counts.total - counts.failed) / counts.total) * 100,
      toolName: labels.get(id) ?? id,
      totalCalls: counts.total,
    }))
    .sort((left, right) => right.totalCalls - left.totalCalls);
};

export const aggregateModelsFromGraphs = (
  graphs: readonly Pick<ToolGraphResponse, 'nodes'>[],
): readonly AnalyticsSlice[] => {
  const counts = new Map<string, number>();
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (node.kind !== 'agent' || node.model === undefined) continue;
      counts.set(node.model, (counts.get(node.model) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
};

export const buildClientCostRows = (
  enrollments: readonly Enrollment[],
  spendByProject: ReadonlyMap<
    string,
    { budgetUtilizationPercent: number | null; spendCents: number }
  > = new Map(),
): readonly ClientCostRow[] =>
  [...enrollments]
    .map((enrollment) => {
      const spend = spendByProject.get(enrollment.projectId);
      return {
        budgetUtilizationPercent: spend?.budgetUtilizationPercent ?? null,
        label: formatClientKeyLabel(enrollment.tenantKey),
        projectId: enrollment.projectId,
        spendCents: spend?.spendCents ?? null,
        state: enrollment.state,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

export const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(cents / 100);
};

export const formatLatencyMs = (ms: number | null): string => {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

export const slicePercent = (
  slices: readonly AnalyticsSlice[],
  index: number,
): number => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return 0;
  return (slices[index]!.value / total) * 100;
};

export const sliceTotal = (slices: readonly AnalyticsSlice[]): number =>
  slices.reduce((sum, slice) => sum + slice.value, 0);

export const formatPercent = (value: number | null): string => {
  if (value === null) return '—';
  return `${value.toFixed(1)}%`;
};

export const donutGradient = (slices: readonly AnalyticsSlice[]): string => {
  const total = sliceTotal(slices);
  if (total === 0) return 'conic-gradient(var(--binflow-border) 0deg 360deg)';
  let cursor = 0;
  const stops: string[] = [];
  slices.forEach((slice, index) => {
    const share = (slice.value / total) * 360;
    const color = DONUT_COLORS[index % DONUT_COLORS.length]!;
    stops.push(`${color} ${cursor}deg ${cursor + share}deg`);
    cursor += share;
  });
  return `conic-gradient(${stops.join(', ')})`;
};
