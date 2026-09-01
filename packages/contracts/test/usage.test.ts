import { describe, expect, it } from 'vitest';

import {
  usageListQuerySchema,
  usageResponseSchema,
} from '../src/index.js';

describe('usage contracts', () => {
  it('defaults range to 7d', () => {
    expect(usageListQuerySchema.parse({})).toEqual({ range: '7d' });
    expect(usageListQuerySchema.parse({ range: '24h' })).toEqual({
      range: '24h',
    });
  });

  it('parses an empty ledger response', () => {
    const empty = usageResponseSchema.parse({
      alerts: [],
      avgCostCentsPerRequest: null,
      avgLatencyMs: null,
      byCapability: [],
      byClient: [],
      byModel: [],
      byNode: [],
      costOverTime: [],
      distinctRequestCount: 0,
      efficiency: [],
      range: '7d',
      rangeEnd: '2026-08-31T18:00:00.000Z',
      rangeStart: '2026-08-25T00:00:00.000Z',
      totalModelCalls: 0,
      totalSpendCents: 0,
    });
    expect(empty.totalSpendCents).toBe(0);
    expect(empty.rangeStart).toMatch(/2026-08-25/);
  });
});
