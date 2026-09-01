import { describe, expect, it, vi } from 'vitest';

import type { UsageResponse } from '@binflow/contracts';

import { buildApp } from '../src/app.js';

const sessionResolver = async () => ({
  actorId: 'owner-1',
  email: 'owner@example.com',
  fresh: true,
  role: 'platform_owner' as const,
  twoFactor: true,
});

const emptyUsage: UsageResponse = {
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
};

describe('usage API', () => {
  it('returns usage for the requested range', async () => {
    const usageService = {
      get: vi.fn(async () => emptyUsage),
    };
    const app = buildApp({
      resolvePlatformOwnerSession: sessionResolver,
      trustedOrigin: 'http://localhost:3000',
      usageService,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/usage?range=24h',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ totalSpendCents: 0, range: '7d' });
    expect(usageService.get).toHaveBeenCalledWith(
      'owner-1',
      expect.any(String),
      '24h',
    );
    await app.close();
  });
});
