import { describe, expect, it, vi } from 'vitest';

import type { CredentialSummary } from '@binflow/contracts';

import { buildApp } from '../src/app.js';

const credential: CredentialSummary = {
  alias: 'Webbin OpenAI',
  bindingProjectKey: null,
  bindingTenantKey: 'webbin',
  createdAt: '2026-08-18T00:00:00.000Z',
  id: 'credential-1',
  kind: 'openai',
  maskedSuffix: '1234',
  ownerScope: 'tenant',
  projectId: null,
  revision: 1,
  status: 'unverified',
  tenantId: 'tenant-1',
  testedAt: null,
  usedAt: null,
  verifiedAt: null,
  version: 1,
};

const createService = () => ({
  create: vi.fn(async () => credential),
  list: vi.fn(async () => [credential]),
  revoke: vi.fn(async () => ({
    ...credential,
    revision: 2,
    status: 'revoked' as const,
  })),
  verify: vi.fn(async () => ({
    credential: {
      ...credential,
      revision: 2,
      status: 'active' as const,
      testedAt: '2026-08-18T00:01:00.000Z',
      verifiedAt: '2026-08-18T00:01:00.000Z',
    },
    outcome: 'success' as const,
  })),
});

const sessionResolver = vi.fn(async () => ({
  actorId: 'owner-1',
  email: 'owner@example.com',
  fresh: true,
  sessionId: 'session-1',
}));

describe('integration administration API', () => {
  it('lists only redacted credential metadata', async () => {
    const app = buildApp({
      integrationService: createService(),
      resolvePlatformOwnerSession: sessionResolver,
    });
    const response = await app.inject('/api/v1/admin/integrations');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [credential], nextCursor: null });
    expect(response.body).not.toContain('apiKey');
    expect(response.body).not.toContain('verificationEvidence');
    await app.close();
  });

  it('accepts a strict one-time secret payload behind fresh mutation guards', async () => {
    const service = createService();
    const app = buildApp({
      integrationService: service,
      resolvePlatformOwnerSession: sessionResolver,
      trustedOrigin: 'http://localhost:3000',
    });
    const apiKey = `sk-${'x'.repeat(24)}-secret`;
    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        origin: 'http://localhost:3000',
      },
      method: 'POST',
      payload: {
        alias: 'Webbin OpenAI',
        apiKey,
        kind: 'openai',
        tenantKey: 'webbin',
      },
      url: '/api/v1/admin/integrations',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.body).not.toContain(apiKey);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'openai', tenantKey: 'webbin' }),
      expect.objectContaining({ actorId: 'owner-1' }),
    );
    expect(sessionResolver).toHaveBeenCalledWith(expect.any(Headers), {
      fresh: true,
      twoFactor: true,
    });
    await app.close();
  });

  it('rejects extra or malformed secret fields without echoing them', async () => {
    const service = createService();
    const app = buildApp({
      integrationService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });
    const secret = 'must-not-appear-in-response';
    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '0123456789abcdef',
        origin: 'http://localhost:3000',
      },
      method: 'POST',
      payload: {
        alias: 'Invalid',
        apiKey: secret,
        extra: secret,
        kind: 'openai',
        tenantKey: 'webbin',
      },
      url: '/api/v1/admin/integrations',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain(secret);
    expect(service.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('binds verification and revocation to the current revision ETag', async () => {
    const service = createService();
    const app = buildApp({
      integrationService: service,
      resolvePlatformOwnerSession: sessionResolver,
    });
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': '0123456789abcdef',
      'if-match': '"1"',
      origin: 'http://localhost:3000',
    };

    const verified = await app.inject({
      headers,
      method: 'POST',
      payload: {},
      url: '/api/v1/admin/integrations/credential-1/verify',
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers.etag).toBe('"2"');
    expect(service.verify).toHaveBeenCalledWith(
      'credential-1',
      1,
      expect.any(Object),
    );

    const revoked = await app.inject({
      headers: { ...headers, 'idempotency-key': 'fedcba9876543210' },
      method: 'POST',
      payload: {},
      url: '/api/v1/admin/integrations/credential-1/revoke',
    });
    expect(revoked.statusCode).toBe(200);
    expect(service.revoke).toHaveBeenCalledWith(
      'credential-1',
      1,
      expect.any(Object),
    );
    await app.close();
  });
});
