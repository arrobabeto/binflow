import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { OTP } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, schema } from '@binflow/db';
import {
  AUTH_SESSION_FRESH_SECONDS,
  bootstrapPlatformOwner,
  createAuthSecretFile,
  createBinflowAuth,
  loadAuthSecret,
  loadLocalAuthSecretFile,
  requirePlatformOwnerSession,
} from '../src/index.js';

const authSecret = 'test-secret-with-at-least-thirty-two-characters';
const baseURL = 'http://localhost:3000';
const ownerEmail = 'owner@example.com';
const ownerPassword = 'correct horse battery staple';

class CookieJar {
  readonly values = new Map<string, string>();

  capture(headers: Headers): void {
    for (const value of headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const separator = pair?.indexOf('=') ?? -1;
      if (pair === undefined || separator < 1) continue;
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      if (cookieValue === '') this.values.delete(name);
      else this.values.set(name, cookieValue);
    }
  }

  header(): string {
    return [...this.values.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

const authRequest = async (
  auth: ReturnType<typeof createBinflowAuth>,
  path: string,
  body: Readonly<Record<string, unknown>>,
  jar: CookieJar,
  origin = baseURL,
): Promise<Response> => {
  const response = await auth.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        cookie: jar.header(),
        origin,
      },
      method: 'POST',
    }),
  );
  jar.capture(response.headers);
  return response;
};

const authGet = async (
  auth: ReturnType<typeof createBinflowAuth>,
  path: string,
  jar: CookieJar,
): Promise<Response> => {
  const response = await auth.handler(
    new Request(`${baseURL}/api/auth${path}`, {
      headers: { cookie: jar.header(), origin: baseURL },
    }),
  );
  jar.capture(response.headers);
  return response;
};

describe('Better Auth secret handling', () => {
  it('creates a protected secret outside the repository and refuses overwrite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'binflow-auth-'));
    const repository = join(directory, 'repository');
    const secretPath = join(directory, 'secrets', 'auth.key');
    await mkdir(repository);
    try {
      await createAuthSecretFile(secretPath, repository);
      const secret = await loadLocalAuthSecretFile(secretPath, repository);
      expect(secret.length).toBeGreaterThanOrEqual(32);
      await expect(
        createAuthSecretFile(secretPath, repository),
      ).rejects.toThrow(/exist/i);
      await chmod(secretPath, 0o644);
      await expect(
        loadLocalAuthSecretFile(secretPath, repository),
      ).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects ambiguous and undersized runtime secrets', async () => {
    await expect(loadAuthSecret({ direct: 'short' })).rejects.toThrow(
      /at least 32/,
    );
    await expect(
      loadAuthSecret({ direct: authSecret, file: '/unused' }),
    ).rejects.toThrow(/only one/);
  });
});

const databaseUrl = process.env.BINFLOW_TEST_DATABASE_URL;
if (
  databaseUrl !== undefined &&
  !new URL(databaseUrl).pathname.slice(1).endsWith('_test')
) {
  throw new Error(
    'BINFLOW_TEST_DATABASE_URL must name a database ending in _test.',
  );
}
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('platform owner authentication', () => {
  const database = createDatabase(databaseUrl!);

  beforeAll(async () => {
    await runMigrations(databaseUrl!);
  });

  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        auth_rate_limits,
        auth_two_factors,
        auth_verifications,
        auth_accounts,
        auth_sessions,
        auth_users,
        audit_events
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await database.pool.end();
  });

  const bootstrap = () =>
    bootstrapPlatformOwner({
      baseURL,
      databaseUrl: databaseUrl!,
      email: ownerEmail,
      name: 'Platform Owner',
      password: ownerPassword,
      secret: authSecret,
    });

  const runtime = () =>
    createBinflowAuth({
      baseURL,
      database: database.db,
      production: false,
      secret: authSecret,
      trustedOrigins: [baseURL],
    });

  it('bootstraps exactly one owner and records an audit event', async () => {
    const created = await bootstrap();
    expect(created.email).toBe(ownerEmail);
    await expect(bootstrap()).rejects.toMatchObject({
      category: 'conflict_error',
    });

    const events = await database.db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.actorId, created.userId));
    expect(events).toContainEqual({
      action: 'auth.platform_owner_bootstrapped',
    });

    await expect(
      database.db.insert(schema.authUsers).values({
        email: 'second@example.com',
        id: 'second-owner',
        name: 'Second Owner',
      }),
    ).rejects.toThrow();
  });

  it('keeps public sign-up disabled and gates password-only sessions', async () => {
    await bootstrap();
    const auth = runtime();
    const signUp = await authRequest(
      auth,
      '/sign-up/email',
      {
        email: 'attacker@example.com',
        name: 'Attacker',
        password: ownerPassword,
      },
      new CookieJar(),
    );
    expect(signUp.status).toBeGreaterThanOrEqual(400);

    const jar = new CookieJar();
    const signIn = await authRequest(
      auth,
      '/sign-in/email',
      { email: ownerEmail, password: ownerPassword },
      jar,
    );
    expect(signIn.status).toBe(200);
    const localCookie = signIn.headers
      .getSetCookie()
      .find((value) => value.includes('session_token'));
    expect(localCookie).toContain('HttpOnly');
    expect(localCookie).toContain('SameSite=Lax');
    expect(localCookie).not.toContain('Secure');
    const persistedSession = await database.db
      .select({ expiresAt: schema.authSessions.expiresAt })
      .from(schema.authSessions)
      .limit(1);
    const remainingHours =
      (persistedSession[0]!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(remainingHours).toBeGreaterThan(11.9);
    expect(remainingHours).toBeLessThanOrEqual(12);
    await expect(
      requirePlatformOwnerSession(auth, new Headers({ cookie: jar.header() })),
    ).rejects.toMatchObject({ category: 'authorization_error' });
  });

  it('marks production cookies secure', async () => {
    await bootstrap();
    const productionURL = 'https://admin.example';
    const auth = createBinflowAuth({
      baseURL: productionURL,
      database: database.db,
      production: true,
      secret: authSecret,
      trustedOrigins: [productionURL],
    });
    const response = await auth.handler(
      new Request(`${productionURL}/api/auth/sign-in/email`, {
        body: JSON.stringify({
          email: ownerEmail,
          password: ownerPassword,
        }),
        headers: {
          'content-type': 'application/json',
          origin: productionURL,
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.includes('session_token'));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
  });

  it('enforces password bounds, trusted origins, and database rate limits', async () => {
    await expect(
      bootstrapPlatformOwner({
        baseURL,
        databaseUrl: databaseUrl!,
        email: ownerEmail,
        name: 'Platform Owner',
        password: 'too short',
        secret: authSecret,
      }),
    ).rejects.toThrow();
    await bootstrap();
    const auth = runtime();

    const authenticatedJar = new CookieJar();
    expect(
      (
        await authRequest(
          auth,
          '/sign-in/email',
          { email: ownerEmail, password: ownerPassword },
          authenticatedJar,
        )
      ).status,
    ).toBe(200);
    const crossOrigin = await authRequest(
      auth,
      '/two-factor/enable',
      { method: 'totp', password: ownerPassword },
      authenticatedJar,
      'https://attacker.example',
    );
    expect(crossOrigin.status).toBe(403);

    const attempts = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      attempts.push(
        await authRequest(
          auth,
          '/sign-in/email',
          { email: ownerEmail, password: 'incorrect password' },
          new CookieJar(),
        ),
      );
    }
    expect(attempts.at(-1)?.status).toBe(429);
    const persistedLimits = await database.db
      .select({ count: schema.authRateLimits.count })
      .from(schema.authRateLimits);
    expect(persistedLimits.length).toBeGreaterThan(0);
  });

  it('enrolls TOTP, rejects trusted devices, and consumes backup codes once', async () => {
    await bootstrap();
    const auth = runtime();
    const enrollmentJar = new CookieJar();
    const dormantPasswordOnlyJar = new CookieJar();
    expect(
      (
        await authRequest(
          auth,
          '/sign-in/email',
          { email: ownerEmail, password: ownerPassword },
          enrollmentJar,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await authRequest(
          auth,
          '/sign-in/email',
          { email: ownerEmail, password: ownerPassword },
          dormantPasswordOnlyJar,
        )
      ).status,
    ).toBe(200);

    const enabled = await authRequest(
      auth,
      '/two-factor/enable',
      { method: 'totp', password: ownerPassword },
      enrollmentJar,
    );
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as {
      backupCodes: string[];
      totpURI: string;
    };
    const secret = new URL(enrollment.totpURI).searchParams.get('secret');
    expect(secret).not.toBeNull();
    const code = await new OTP({ strategy: 'totp' }).generate({
      secret: secret!,
    });

    const trustedDeviceAttempt = await authRequest(
      auth,
      '/two-factor/verify-totp',
      { code, trustDevice: true },
      enrollmentJar,
    );
    expect(trustedDeviceAttempt.status).toBe(400);
    expect(await trustedDeviceAttempt.text()).toContain(
      'Trusted devices are disabled',
    );

    const verified = await authRequest(
      auth,
      '/two-factor/verify-totp',
      { code, trustDevice: false },
      enrollmentJar,
    );
    expect(verified.status).toBe(200);
    await expect(
      requirePlatformOwnerSession(
        auth,
        new Headers({ cookie: enrollmentJar.header() }),
      ),
    ).resolves.toMatchObject({ email: ownerEmail, fresh: true });
    await expect(
      requirePlatformOwnerSession(
        auth,
        new Headers({ cookie: dormantPasswordOnlyJar.header() }),
      ),
    ).rejects.toMatchObject({ category: 'authentication_error' });

    const backupCode = enrollment.backupCodes[0];
    expect(backupCode).toBeDefined();
    const firstBackupJar = new CookieJar();
    expect(
      (
        await authRequest(
          auth,
          '/sign-in/email',
          { email: ownerEmail, password: ownerPassword },
          firstBackupJar,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await authRequest(
          auth,
          '/two-factor/verify-backup-code',
          { code: backupCode, trustDevice: false },
          firstBackupJar,
        )
      ).status,
    ).toBe(200);
    const backupSession = await requirePlatformOwnerSession(
      auth,
      new Headers({ cookie: firstBackupJar.header() }),
    );
    expect(backupSession).toMatchObject({ email: ownerEmail });

    const listedResponse = await authGet(
      auth,
      '/list-sessions',
      firstBackupJar,
    );
    expect(listedResponse.status).toBe(200);
    const listed = (await listedResponse.json()) as Array<{
      id: string;
      token: string;
    }>;
    const current = listed.find((item) => item.id === backupSession.sessionId);
    expect(current).toBeDefined();
    expect(
      (
        await authRequest(
          auth,
          '/revoke-session',
          { token: current!.token },
          firstBackupJar,
        )
      ).status,
    ).toBe(200);
    await expect(
      requirePlatformOwnerSession(
        auth,
        new Headers({ cookie: firstBackupJar.header() }),
      ),
    ).rejects.toMatchObject({ category: 'authentication_error' });

    const reusedBackupJar = new CookieJar();
    await authRequest(
      auth,
      '/sign-in/email',
      { email: ownerEmail, password: ownerPassword },
      reusedBackupJar,
    );
    const reused = await authRequest(
      auth,
      '/two-factor/verify-backup-code',
      { code: backupCode, trustDevice: false },
      reusedBackupJar,
    );
    expect(reused.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a session outside the five-minute freshness window', async () => {
    await bootstrap();
    const auth = runtime();
    const jar = new CookieJar();
    await authRequest(
      auth,
      '/sign-in/email',
      { email: ownerEmail, password: ownerPassword },
      jar,
    );
    await database.db.execute(sql`
      update auth_sessions
      set created_at = now() - (${AUTH_SESSION_FRESH_SECONDS + 1} * interval '1 second')
    `);

    await expect(
      requirePlatformOwnerSession(auth, new Headers({ cookie: jar.header() }), {
        fresh: true,
        twoFactor: false,
      }),
    ).rejects.toMatchObject({
      category: 'authorization_error',
      metadata: { code: 'fresh_session_required' },
    });
  });
});
