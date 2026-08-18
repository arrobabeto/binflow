import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('GET /api/v1/health', () => {
  it('returns the versioned health contract', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject('/api/v1/health');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: 'api', status: 'ok' });
  });
});

describe('GET /api/v1/readiness', () => {
  it('returns 200 only when every dependency is ready', async () => {
    const ready = buildApp({
      readinessCheck: async () => ({
        checks: { database: 'ready', worker: 'ready' },
        status: 'ready',
        timestamp: '2026-08-18T00:00:00.000Z',
      }),
    });
    const unavailable = buildApp({
      readinessCheck: async () => ({
        checks: { database: 'ready', worker: 'stale' },
        status: 'not_ready',
        timestamp: '2026-08-18T00:00:00.000Z',
      }),
    });
    apps.push(ready, unavailable);

    expect((await ready.inject('/api/v1/readiness')).statusCode).toBe(200);
    expect((await unavailable.inject('/api/v1/readiness')).statusCode).toBe(
      503,
    );
  });
});
