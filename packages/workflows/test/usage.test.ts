import { describe, expect, it } from 'vitest';

import {
  buildUsageResponse,
  usageRangeStart,
  type UsageCallRow,
} from '../src/usage.js';

const call = (
  overrides: Partial<UsageCallRow> & Pick<UsageCallRow, 'createdAt'>,
): UsageCallRow => ({
  estimatedCostCents: 10,
  inputTokens: 100,
  latencyMs: 500,
  model: 'gpt-test',
  node: 'plan',
  outputTokens: 50,
  projectId: 'project-1',
  provider: 'openai',
  requestId: 'req-1',
  requestVersionId: 'ver-1',
  tenantId: 'tenant-1',
  ...overrides,
});

describe('usageRangeStart', () => {
  const now = new Date('2026-08-31T15:00:00.000Z');

  it('matches Analytics rolling 24h and UTC calendar windows', () => {
    expect(usageRangeStart('all', now)).toBeNull();
    expect(usageRangeStart('24h', now)?.toISOString()).toBe(
      '2026-08-30T15:00:00.000Z',
    );
    expect(usageRangeStart('7d', now)?.toISOString()).toBe(
      '2026-08-25T00:00:00.000Z',
    );
    expect(usageRangeStart('30d', now)?.toISOString()).toBe(
      '2026-08-02T00:00:00.000Z',
    );
  });
});

describe('buildUsageResponse', () => {
  const now = new Date('2026-08-31T15:00:00.000Z');

  it('aggregates spend, latency, series, and budget alerts', () => {
    const response = buildUsageResponse({
      budgets: [
        {
          maxEstimatedCostCentsPerDay: 20,
          projectId: 'project-1',
          tenantId: 'tenant-1',
        },
      ],
      calls: [
        call({
          createdAt: new Date('2026-08-30T12:00:00.000Z'),
          estimatedCostCents: 12,
          latencyMs: 400,
        }),
        call({
          createdAt: new Date('2026-08-31T10:00:00.000Z'),
          estimatedCostCents: 8,
          latencyMs: 600,
          node: 'execute',
          requestId: 'req-2',
          requestVersionId: 'ver-2',
        }),
      ],
      capabilities: [
        { capabilityId: 'create_blog_draft', requestVersionId: 'ver-1' },
        { capabilityId: 'create_blog_draft', requestVersionId: 'ver-2' },
      ],
      now,
      range: '7d',
    });

    expect(response.totalSpendCents).toBe(20);
    expect(response.totalModelCalls).toBe(2);
    expect(response.distinctRequestCount).toBe(2);
    expect(response.avgCostCentsPerRequest).toBe(10);
    expect(response.avgLatencyMs).toBe(500);
    expect(response.costOverTime).toEqual([
      { day: '2026-08-30', spendCents: 12 },
      { day: '2026-08-31', spendCents: 8 },
    ]);
    expect(response.byCapability[0]).toMatchObject({
      capabilityId: 'create_blog_draft',
      modelCalls: 2,
      spendCents: 20,
    });
    expect(response.byNode).toHaveLength(2);
    expect(response.byClient[0]?.budgetUtilizationPercent).toBeCloseTo(
      (20 / (20 * 7)) * 100,
    );
    expect(response.alerts).toHaveLength(0);
    expect(response.efficiency[0]?.score).toBeGreaterThanOrEqual(0);
  });

  it('emits critical budget alerts when utilization exceeds 100%', () => {
    const response = buildUsageResponse({
      budgets: [
        {
          maxEstimatedCostCentsPerDay: 5,
          projectId: 'project-1',
          tenantId: 'tenant-1',
        },
      ],
      calls: [
        call({
          createdAt: new Date('2026-08-31T10:00:00.000Z'),
          estimatedCostCents: 50,
        }),
      ],
      capabilities: [
        { capabilityId: 'edit_text', requestVersionId: 'ver-1' },
      ],
      now,
      range: '24h',
    });

    expect(response.byClient[0]?.budgetUtilizationPercent).toBe(1000);
    expect(response.alerts[0]).toMatchObject({
      kind: 'budget_day_utilization',
      severity: 'critical',
      projectId: 'project-1',
    });
  });

  it('returns empty ledger without inventing spend', () => {
    const response = buildUsageResponse({
      budgets: [],
      calls: [],
      capabilities: [],
      now,
      range: 'all',
    });
    expect(response).toMatchObject({
      alerts: [],
      avgCostCentsPerRequest: null,
      avgLatencyMs: null,
      rangeStart: null,
      totalModelCalls: 0,
      totalSpendCents: 0,
    });
  });
});
