import { describe, expect, it } from 'vitest';

import {
  aggregateFailedRequestsByCapability,
  aggregateModelsFromGraphs,
  aggregateRequestsByCapability,
  analyticsRangeDetail,
  analyticsRangeStart,
  buildClientCostRows,
  buildToolUsageRows,
  filterRequestsByDateRange,
  formatPercent,
  sliceTotal,
} from '../app/lib/analytics-metrics';

describe('analytics metrics', () => {
  const tools = [
    { displayName: 'Create blog', id: 'create_blog_draft' },
    { displayName: 'Delete blog', id: 'delete_blog_draft' },
  ] as const;

  it('aggregates requests and failures by capability', () => {
    const requests = [
      { capabilityId: 'create_blog_draft' as const, state: 'COMPLETED' as const },
      { capabilityId: 'create_blog_draft' as const, state: 'FAILED_FINAL' as const },
      { capabilityId: 'delete_blog_draft' as const, state: 'CANCELLED' as const },
    ];
    expect(aggregateRequestsByCapability(requests, tools)).toEqual([
      { label: 'Create blog', value: 2 },
      { label: 'Delete blog', value: 1 },
    ]);
    expect(aggregateFailedRequestsByCapability(requests, tools)).toEqual([
      { label: 'Create blog', value: 1 },
    ]);
    expect(buildToolUsageRows(requests, tools)[0]).toMatchObject({
      failedCalls: 1,
      toolName: 'Create blog',
      totalCalls: 2,
    });
    expect(formatPercent(50)).toBe('50.0%');
  });

  it('aggregates configured models from agent graph nodes', () => {
    const slices = aggregateModelsFromGraphs([
      {
        nodes: [
          { kind: 'agent', model: 'gpt-5.6-luna' },
          { kind: 'agent', model: 'gpt-5.6-terra' },
          { kind: 'compute' },
          { kind: 'agent', model: 'gpt-5.6-luna' },
        ],
      } as never,
    ]);
    expect(slices).toEqual([
      { label: 'gpt-5.6-luna', value: 2 },
      { label: 'gpt-5.6-terra', value: 1 },
    ]);
    expect(sliceTotal(slices)).toBe(3);
  });

  it('filters requests by analytics date range using createdAt (UTC days)', () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const requests = [
      { createdAt: '2026-08-30T12:00:00.000Z' },
      { createdAt: '2026-08-29T16:00:00.000Z' },
      { createdAt: '2026-08-24T12:00:00.000Z' },
      { createdAt: '2026-07-01T12:00:00.000Z' },
    ];
    expect(filterRequestsByDateRange(requests, '24h', now)).toHaveLength(2);
    expect(filterRequestsByDateRange(requests, '7d', now)).toHaveLength(3);
    expect(filterRequestsByDateRange(requests, '30d', now)).toHaveLength(3);
    expect(filterRequestsByDateRange(requests, 'all', now)).toHaveLength(4);
    expect(analyticsRangeStart('all', now)).toBeNull();
    expect(analyticsRangeDetail('24h')).toContain('24 hours');
  });

  it('lists enrollment clients for cost table', () => {
    expect(
      buildClientCostRows([
        {
          tenantKey: 'webbin',
          state: 'active',
        } as never,
      ]),
    ).toEqual([{ label: 'Webbin', state: 'active' }]);
  });
});
