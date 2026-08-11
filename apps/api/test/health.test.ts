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
