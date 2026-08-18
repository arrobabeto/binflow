import { randomBytes } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { encryptSecret } from '@binflow/secrets';

import { createDatabase } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import {
  ensureDraftScope,
  recordCredentialVerificationFailure,
  recordCredentialVerificationSuccess,
  resolveScope,
  revokeCredential,
  storeCredentialVersion,
} from '../src/repository.js';
import { integrationConnections, providerCredentials } from '../src/schema.js';

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

describeDatabase('credential lifecycle database invariants', () => {
  const database = createDatabase(databaseUrl!);
  const masterKey = randomBytes(32);

  beforeAll(async () => runMigrations(databaseUrl!));

  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        credential_events,
        integration_connections,
        provider_credentials,
        secret_references,
        projects,
        tenants
      restart identity cascade
    `);
  });

  afterAll(async () => {
    masterKey.fill(0);
    await database.pool.end();
  });

  const storeTenantCredential = async (
    credentialId: string,
    tenantId: string,
  ) => {
    const context = {
      credentialId,
      keyVersion: 1,
      provider: 'openai',
      tenantId,
    } as const;
    const plaintext = Buffer.from(JSON.stringify({ apiKey: credentialId }));
    const envelope = encryptSecret(plaintext, masterKey, context);
    plaintext.fill(0);
    await storeCredentialVersion(database.db, {
      alias: 'OpenAI',
      configuration: { requiredModels: ['fixture-model'] },
      credentialId,
      envelope,
      kind: 'openai',
      maskedSuffix: 'ture',
      ownerScope: 'tenant',
      scope: { tenantId },
    });
  };

  it('preserves the healthy version until a candidate verifies successfully', async () => {
    const scope = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    await storeTenantCredential('credential-v1', scope.tenantId);
    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:00:00.000Z'),
      credentialId: 'credential-v1',
      evidence: { modelCount: 4 },
    });

    await storeTenantCredential('credential-v2', scope.tenantId);
    await recordCredentialVerificationFailure(database.db, {
      category: 'authentication_error',
      checkedAt: new Date('2026-08-11T00:01:00.000Z'),
      credentialId: 'credential-v2',
      permanent: true,
    });
    await storeTenantCredential('credential-v3', scope.tenantId);
    await recordCredentialVerificationFailure(database.db, {
      category: 'provider_retryable',
      checkedAt: new Date('2026-08-11T00:02:00.000Z'),
      credentialId: 'credential-v3',
      permanent: false,
    });

    expect(
      await database.db
        .select({
          id: providerCredentials.id,
          status: providerCredentials.status,
        })
        .from(providerCredentials)
        .orderBy(providerCredentials.version),
    ).toEqual([
      { id: 'credential-v1', status: 'active' },
      { id: 'credential-v2', status: 'invalid' },
      { id: 'credential-v3', status: 'unverified' },
    ]);

    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:03:00.000Z'),
      credentialId: 'credential-v3',
      evidence: { modelCount: 4 },
    });
    await expect(
      recordCredentialVerificationSuccess(database.db, {
        checkedAt: new Date('2026-08-11T00:04:00.000Z'),
        credentialId: 'credential-v2',
        evidence: { modelCount: 4 },
      }),
    ).rejects.toMatchObject({ category: 'conflict_error' });
    expect(
      await database.db
        .select({
          id: providerCredentials.id,
          status: providerCredentials.status,
        })
        .from(providerCredentials)
        .orderBy(providerCredentials.version),
    ).toEqual([
      { id: 'credential-v1', status: 'superseded' },
      { id: 'credential-v2', status: 'invalid' },
      { id: 'credential-v3', status: 'active' },
    ]);
  });

  it('cannot reactivate a credential revoked before activation is recorded', async () => {
    const scope = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    await storeTenantCredential('credential-revoked', scope.tenantId);
    await revokeCredential(database.db, 'credential-revoked');

    await expect(
      recordCredentialVerificationSuccess(database.db, {
        checkedAt: new Date('2026-08-11T00:00:00.000Z'),
        credentialId: 'credential-revoked',
        evidence: {},
      }),
    ).rejects.toMatchObject({ category: 'credential_unavailable' });
    await expect(
      database.db.query.providerCredentials.findFirst({
        where: eq(providerCredentials.id, 'credential-revoked'),
      }),
    ).resolves.toMatchObject({ status: 'revoked' });
  });

  it('increments the dashboard revision and rejects stale revocation', async () => {
    const scope = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    await storeTenantCredential('credential-etag', scope.tenantId);
    await expect(
      database.db.query.providerCredentials.findFirst({
        where: eq(providerCredentials.id, 'credential-etag'),
      }),
    ).resolves.toMatchObject({ revision: 1, status: 'unverified' });

    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:00:00.000Z'),
      credentialId: 'credential-etag',
      evidence: { modelCount: 4 },
    });
    await expect(
      revokeCredential(database.db, 'credential-etag', 1),
    ).rejects.toMatchObject({ category: 'conflict_error' });
    await expect(
      revokeCredential(database.db, 'credential-etag', 2),
    ).resolves.toBe(true);
    await expect(
      database.db.query.providerCredentials.findFirst({
        where: eq(providerCredentials.id, 'credential-etag'),
      }),
    ).resolves.toMatchObject({ revision: 3, status: 'revoked' });
  });

  it('persists only safe GitHub binding evidence and its external installation ID', async () => {
    const scope = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    const context = {
      credentialId: 'github-platform',
      keyVersion: 1,
      provider: 'github-app',
      tenantId: 'platform',
    } as const;
    const plaintext = Buffer.from(
      JSON.stringify({
        privateKey: 'fixture-private-key',
        webhookSecret: 'fixture-webhook-secret',
      }),
    );
    const envelope = encryptSecret(plaintext, masterKey, context);
    plaintext.fill(0);
    await storeCredentialVersion(database.db, {
      alias: 'GitHub App',
      configuration: { appId: '123', clientId: 'Iv1.binflow' },
      connection: {
        configuration: {
          defaultBranch: 'main',
          expectedRepository: 'arrobabeto/webbin',
        },
        kind: 'github-app',
        scope,
      },
      credentialId: context.credentialId,
      envelope,
      kind: 'github-app',
      maskedSuffix: 'n/a',
      ownerScope: 'platform',
      scope: {},
    });
    const evidence = {
      externalResourceId: '456',
      repository: 'arrobabeto/webbin',
      repositoryId: '789',
    };
    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:00:00.000Z'),
      credentialId: context.credentialId,
      evidence,
    });

    const connection =
      await database.db.query.integrationConnections.findFirst();
    expect(connection).toMatchObject({
      externalResourceId: '456',
      status: 'active',
      verificationEvidence: evidence,
    });
    expect(JSON.stringify(connection)).not.toContain('fixture-private-key');
    expect(JSON.stringify(connection)).not.toContain('fixture-webhook-secret');

    const replacementContext = {
      ...context,
      credentialId: 'github-platform-v2',
    };
    const replacementPlaintext = Buffer.from(
      JSON.stringify({
        privateKey: 'replacement-private-key',
        webhookSecret: 'replacement-webhook-secret',
      }),
    );
    const replacementEnvelope = encryptSecret(
      replacementPlaintext,
      masterKey,
      replacementContext,
    );
    replacementPlaintext.fill(0);
    await storeCredentialVersion(database.db, {
      alias: 'GitHub App replacement',
      configuration: { appId: '123', clientId: 'Iv1.binflow' },
      connection: {
        configuration: {
          defaultBranch: 'main',
          expectedRepository: 'arrobabeto/webbin',
        },
        kind: 'github-app',
        scope,
      },
      credentialId: replacementContext.credentialId,
      envelope: replacementEnvelope,
      kind: 'github-app',
      maskedSuffix: 'n/a',
      ownerScope: 'platform',
      scope: {},
    });
    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:01:00.000Z'),
      credentialId: replacementContext.credentialId,
      evidence: { ...evidence, externalResourceId: '457' },
    });
    const connections = await database.db
      .select({
        credentialId: integrationConnections.credentialId,
        status: integrationConnections.status,
      })
      .from(integrationConnections);
    expect(
      Object.fromEntries(
        connections.map((row) => [row.credentialId, row.status]),
      ),
    ).toEqual({
      'github-platform': 'superseded',
      'github-platform-v2': 'active',
    });
  });

  it('resolves tenant-local project keys without cross-tenant ambiguity', async () => {
    const first = await ensureDraftScope(database.db, {
      projectKey: 'website',
      tenantKey: 'tenant-one',
    });
    const second = await ensureDraftScope(database.db, {
      projectKey: 'website',
      tenantKey: 'tenant-two',
    });

    await expect(
      resolveScope(database.db, {
        projectKey: 'website',
        tenantKey: 'tenant-one',
      }),
    ).resolves.toEqual(first);
    await expect(
      resolveScope(database.db, {
        projectKey: 'website',
        tenantKey: 'tenant-two',
      }),
    ).resolves.toEqual(second);
    await expect(
      resolveScope(database.db, { projectKey: 'website' }),
    ).rejects.toThrow('Project scope requires a tenant key.');
  });

  it('rejects a connection that binds another tenant project', async () => {
    const first = await ensureDraftScope(database.db, {
      projectKey: 'website',
      tenantKey: 'tenant-one',
    });
    const second = await ensureDraftScope(database.db, {
      projectKey: 'website',
      tenantKey: 'tenant-two',
    });
    const context = {
      credentialId: 'github-cross-tenant',
      keyVersion: 1,
      provider: 'github-app',
      tenantId: 'platform',
    } as const;
    const plaintext = Buffer.from(JSON.stringify({ privateKey: 'fixture' }));
    const envelope = encryptSecret(plaintext, masterKey, context);
    plaintext.fill(0);

    await expect(
      storeCredentialVersion(database.db, {
        alias: 'GitHub App',
        configuration: { appId: '123', clientId: 'Iv1.binflow' },
        connection: {
          configuration: {
            defaultBranch: 'main',
            expectedRepository: 'arrobabeto/webbin',
          },
          kind: 'github-app',
          scope: {
            projectId: first.projectId,
            tenantId: second.tenantId,
          },
        },
        credentialId: context.credentialId,
        envelope,
        kind: 'github-app',
        maskedSuffix: 'n/a',
        ownerScope: 'platform',
        scope: {},
      }),
    ).rejects.toMatchObject({ category: 'policy_denied' });
  });

  it('rejects a project credential connected to another valid project', async () => {
    const owner = await ensureDraftScope(database.db, {
      projectKey: 'owner-project',
      tenantKey: 'owner-tenant',
    });
    const webbin = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    const context = {
      credentialId: 'vercel-cross-project',
      keyVersion: 1,
      provider: 'vercel',
      tenantId: owner.tenantId,
    } as const;
    const plaintext = Buffer.from(JSON.stringify({ token: 'fixture' }));
    const envelope = encryptSecret(plaintext, masterKey, context);
    plaintext.fill(0);

    await expect(
      storeCredentialVersion(database.db, {
        alias: 'Vercel',
        configuration: {},
        connection: {
          configuration: {
            expectedProductionBranch: 'main',
            expectedRepository: 'arrobabeto/webbin',
            projectId: 'prj_webbin',
          },
          kind: 'vercel',
          scope: webbin,
        },
        credentialId: context.credentialId,
        envelope,
        kind: 'vercel',
        maskedSuffix: 'ture',
        ownerScope: 'project',
        scope: owner,
      }),
    ).rejects.toMatchObject({ category: 'policy_denied' });
  });

  it('does not activate the same Telegram bot in two bindings', async () => {
    const scope = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    const storeTelegram = async (
      credentialId: string,
      kind: 'telegram-admin' | 'telegram-client',
    ) => {
      const tenantId = kind === 'telegram-admin' ? 'platform' : scope.tenantId;
      const context = {
        credentialId,
        keyVersion: 1,
        provider: kind,
        tenantId,
      } as const;
      const plaintext = Buffer.from(JSON.stringify({ botToken: 'fixture' }));
      const envelope = encryptSecret(plaintext, masterKey, context);
      plaintext.fill(0);
      await storeCredentialVersion(database.db, {
        alias: kind,
        configuration: {
          expectedUsername: kind,
          role: kind === 'telegram-admin' ? 'admin' : 'client',
        },
        credentialId,
        envelope,
        kind,
        maskedSuffix: 'ture',
        ownerScope: kind === 'telegram-admin' ? 'platform' : 'tenant',
        scope: kind === 'telegram-admin' ? {} : { tenantId: scope.tenantId },
      });
    };
    await storeTelegram('telegram-admin', 'telegram-admin');
    await storeTelegram('telegram-client', 'telegram-client');
    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:00:00.000Z'),
      credentialId: 'telegram-admin',
      evidence: { externalResourceId: '42' },
    });

    await expect(
      recordCredentialVerificationSuccess(database.db, {
        checkedAt: new Date('2026-08-11T00:01:00.000Z'),
        credentialId: 'telegram-client',
        evidence: { externalResourceId: '42' },
      }),
    ).rejects.toMatchObject({ category: 'policy_denied' });

    await storeTelegram('telegram-admin-v2', 'telegram-admin');
    await expect(
      recordCredentialVerificationSuccess(database.db, {
        checkedAt: new Date('2026-08-11T00:02:00.000Z'),
        credentialId: 'telegram-admin-v2',
        evidence: { externalResourceId: '42' },
      }),
    ).resolves.toBeUndefined();
    await expect(
      database.db.query.providerCredentials.findFirst({
        where: eq(providerCredentials.id, 'telegram-admin-v2'),
      }),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('discards a late older failure without regressing active state', async () => {
    const scope = await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    await storeTenantCredential('credential-monotonic', scope.tenantId);
    await recordCredentialVerificationSuccess(database.db, {
      checkedAt: new Date('2026-08-11T00:02:00.000Z'),
      credentialId: 'credential-monotonic',
      evidence: { modelCount: 4 },
    });
    await recordCredentialVerificationFailure(database.db, {
      category: 'authentication_error',
      checkedAt: new Date('2026-08-11T00:01:00.000Z'),
      credentialId: 'credential-monotonic',
      permanent: true,
    });

    await expect(
      database.db.query.providerCredentials.findFirst({
        where: eq(providerCredentials.id, 'credential-monotonic'),
      }),
    ).resolves.toMatchObject({
      status: 'active',
      testedAt: new Date('2026-08-11T00:02:00.000Z'),
      verifiedAt: new Date('2026-08-11T00:02:00.000Z'),
    });
  });
});
