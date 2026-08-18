import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '@binflow/domain';

import { buildApp } from '../src/app.js';

describe('platform owner session bridge', () => {
  it('returns only the redacted session contract', async () => {
    const resolvePlatformOwnerSession = vi.fn(async () => ({
      actorId: 'owner-1',
      email: 'owner@example.com',
      fresh: true,
      sessionId: 'secret-session-id',
    }));
    const app = buildApp({ resolvePlatformOwnerSession });

    const response = await app.inject({
      headers: { cookie: 'better-auth.session_token=secret' },
      method: 'GET',
      url: '/api/v1/session',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      actorId: 'owner-1',
      email: 'owner@example.com',
      fresh: true,
      role: 'platform_owner',
      twoFactor: true,
    });
    expect(resolvePlatformOwnerSession).toHaveBeenCalledTimes(1);
    expect(resolvePlatformOwnerSession.mock.calls[0]?.[0].get('cookie')).toBe(
      'better-auth.session_token=secret',
    );
    await app.close();
  });

  it('normalizes authentication failures without exposing cookies', async () => {
    const app = buildApp({
      resolvePlatformOwnerSession: async () => {
        throw new DomainError(
          'authentication_error',
          'Authentication is required.',
        );
      },
    });

    const response = await app.inject({
      headers: { cookie: 'better-auth.session_token=must-not-leak' },
      method: 'GET',
      url: '/api/v1/session',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('must-not-leak');
    expect(response.json()).toMatchObject({
      error: { category: 'authentication_error' },
    });
    await app.close();
  });
});
