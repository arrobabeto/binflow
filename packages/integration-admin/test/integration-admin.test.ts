import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { phase0OpenAIModels } from '@binflow/ai';
import {
  createDatabase,
  ensureDraftScope,
  runMigrations,
  schema,
} from '@binflow/db';
import type { CredentialVerifier } from '@binflow/integrations';

import { IntegrationAdminService } from '../src/index.js';

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

describeDatabase('integration administration service', () => {
  const database = createDatabase(databaseUrl!);
  const masterKey = randomBytes(32);
  const verifier: CredentialVerifier = {
    kinds: ['openai'],
    verify: async () => ({
      modelCount: phase0OpenAIModels.length,
      requiredModels: [...phase0OpenAIModels],
    }),
  };
  let loadedKey: Buffer | undefined;
  const service = new IntegrationAdminService(
    database.db,
    async () => {
      loadedKey = Buffer.from(masterKey);
      return loadedKey;
    },
    [verifier],
  );
  const context = {
    actorId: 'owner-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'integration-test-key-0001',
  };

  beforeAll(async () => runMigrations(databaseUrl!));
  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        outbox_events,
        audit_events,
        idempotency_records,
        credential_events,
        integration_connections,
        provider_credentials,
        secret_references,
        projects,
        tenants
      restart identity cascade
    `);
    await ensureDraftScope(database.db, {
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
  });
  afterAll(async () => {
    masterKey.fill(0);
    await database.pool.end();
  });

  it('stores a candidate once and exposes only its safe summary', async () => {
    const apiKey = `sk-${'s'.repeat(28)}-private`;
    const input = {
      alias: 'Webbin OpenAI',
      apiKey,
      kind: 'openai' as const,
      tenantKey: 'webbin',
    };

    const first = await service.create(input, context);
    const replay = await service.create(input, context);
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      bindingTenantKey: 'webbin',
      kind: 'openai',
      maskedSuffix: apiKey.slice(-4),
      revision: 1,
      status: 'unverified',
      version: 1,
    });
    expect(loadedKey).toEqual(Buffer.alloc(32));

    const persisted = JSON.stringify({
      audits: await database.db.select().from(schema.auditEvents),
      credentials: await database.db.select().from(schema.providerCredentials),
      idempotency: await database.db.select().from(schema.idempotencyRecords),
      outbox: await database.db.select().from(schema.outboxEvents),
      secrets: await database.db.select().from(schema.secretReferences),
    });
    expect(persisted).not.toContain(apiKey);
    expect(persisted).not.toContain('sk-');
    await expect(
      service.create(
        { ...input, apiKey: `sk-${'x'.repeat(28)}-changed` },
        context,
      ),
    ).rejects.toMatchObject({ category: 'conflict_error' });
  });

  it('verifies with optimistic concurrency without returning evidence', async () => {
    const candidate = await service.create(
      {
        alias: 'Webbin OpenAI',
        apiKey: `sk-${'s'.repeat(28)}-private`,
        kind: 'openai',
        tenantKey: 'webbin',
      },
      context,
    );
    const result = await service.verify(candidate.id, candidate.revision, {
      ...context,
      idempotencyKey: 'integration-test-key-0002',
    });

    expect(result).toMatchObject({
      credential: { revision: 2, status: 'active' },
      outcome: 'success',
    });
    expect(result).not.toHaveProperty('evidence');
    await expect(
      service.verify(candidate.id, candidate.revision, {
        ...context,
        idempotencyKey: 'integration-test-key-0002',
      }),
    ).resolves.toEqual(result);
    await expect(
      service.revoke(candidate.id, candidate.revision, {
        ...context,
        idempotencyKey: 'integration-test-key-0003',
      }),
    ).rejects.toMatchObject({ category: 'conflict_error' });
  });
});
