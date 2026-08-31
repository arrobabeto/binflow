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
  failedCalls: number;
  successRate: number | null;
  toolName: string;
  totalCalls: number;
}>;

export type ClientCostRow = Readonly<{
  label: string;
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
  return 'All loaded batches';
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
): readonly ClientCostRow[] =>
  [...enrollments]
    .map((enrollment) => ({
      label: formatClientKeyLabel(enrollment.tenantKey),
      state: enrollment.state,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

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
