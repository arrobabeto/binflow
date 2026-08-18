import { describe, expect, it, vi } from 'vitest';

import type { Enrollment } from '@binflow/contracts';

import { buildApp } from '../src/app.js';

const enrollment: Enrollment = {
  configuration: {},
  createdAt: '2026-08-18T00:00:00.000Z',
  currentStep: 1,
  id: 'enrollment-1',
  lastValidatedAt: null,
  projectId: 'project-1',
  projectKey: 'webbin',
  state: 'draft',
  tenantId: 'tenant-1',
  tenantKey: 'webbin',
  updatedAt: '2026-08-18T00:00:00.000Z',
  version: 1,
};

const createService = () => ({
  create: vi.fn(async () => enrollment),
  createPairingLink: vi.fn(async () => ({
    enrollment: {
      ...enrollment,
      state: 'pairing_pending' as const,
      version: 2,
    },
    expiresAt: '2026-08-19T00:00:00.000Z',
    pairingUrl: 'https://t.me/binflow_client_bot?start=one-time-token',
  })),
  get: vi.fn(async () => enrollment),
  evaluateActivation: vi.fn(async () => ({
    blockers: ['github_reversible_probe'],
    ready: false,
  })),
  list: vi.fn(async () => [enrollment]),
  update: vi.fn(async () => ({
    ...enrollment,
    state: 'configuring' as const,
    version: 2,
  })),
  validate: vi.fn(async () => ({ attempts: [], enrollment })),
});

const sessionResolver = vi.fn(async () => ({
  actorId: 'owner-1',
  email: 'owner@example.com',
  fresh: true,
  sessionId: 'session-1',
}));

describe('client enrollment API', () => {
  it('returns the mutable resource with a strong ETag', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/enrollments/enrollment-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.json()).toEqual(enrollment);
    await app.close();
  });

  it('requires a fresh session, trusted origin, idempotency and ETag for updates', async () => {
    const service = createService();
    const resolver = vi.fn(sessionResolver);
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: resolver,
      trustedOrigin: 'http://localhost:3000',
    });

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        'if-match': '"1"',
        origin: 'http://localhost:3000',
      },
      method: 'PATCH',
      payload: { configuration: {}, currentStep: 2 },
      url: '/api/v1/admin/enrollments/enrollment-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"2"');
    expect(resolver).toHaveBeenCalledWith(expect.any(Headers), {
      fresh: true,
      twoFactor: true,
    });
    expect(service.update).toHaveBeenCalledWith(
      'enrollment-1',
      { configuration: {}, currentStep: 2 },
      1,
      expect.objectContaining({ actorId: 'owner-1' }),
    );
    await app.close();
  });

  it('rejects stale or missing mutation guards before calling the service', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      headers: { origin: 'http://localhost:3000' },
      method: 'PATCH',
      payload: { configuration: {}, currentStep: 2 },
      url: '/api/v1/admin/enrollments/enrollment-1',
    });

    expect(response.statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps activation fail-closed while mutable evidence is absent', async () => {
    const service = createService();
    const app = buildApp({
      enrollmentService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        'if-match': '"1"',
        origin: 'http://localhost:3000',
      },
      method: 'POST',
      payload: {},
      url: '/api/v1/admin/enrollments/enrollment-1/activate',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'activation_evidence_missing' },
    });
    await app.close();
  });
});
