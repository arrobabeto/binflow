import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  runMigrations,
  schema,
  withPlatformOwnerScope,
} from '@binflow/db';

import { EnrollmentService } from '../src/index.js';

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

describeDatabase('piloter pairing and subset', () => {
  const database = createDatabase(databaseUrl!);
  const service = new EnrollmentService(database.db, {
    now: () => new Date('2026-09-03T00:00:00.000Z'),
  });

  beforeAll(async () => runMigrations(databaseUrl!));
  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        piloter_capability_bindings,
        project_budget_policies,
        project_locales,
        project_manifest_versions,
        pairing_tokens,
        channel_identities,
        memberships,
        client_users,
        enrollment_validation_attempts,
        client_enrollments,
        idempotency_records,
        outbox_events,
        audit_events,
        credential_events,
        integration_connections,
        provider_credentials,
        secret_references,
        projects,
        tenants
      restart identity cascade
    `);
  });
  afterAll(async () => database.pool.end());

  const context = (idempotencyKey: string) => ({
    actorId: 'owner-1',
    correlationId: `correlation-${idempotencyKey}`,
    idempotencyKey,
  });

  it('rejects Piloter pairing before active enrollment and stores subset', async () => {
    const enrollment = await service.create(
      {
        projectKey: 'demo',
        projectProfile: 'astro_repo',
        tenantDisplayName: 'Demo',
        tenantKey: 'demo',
      },
      context('create-piloter'),
    );

    await expect(
      service.createPiloterPairingLink(
        enrollment.id,
        enrollment.version,
        context('piloter-link-early'),
      ),
    ).rejects.toMatchObject({
      metadata: { code: 'piloter_pairing_not_ready' },
    });

    const status = await service.getPiloter(
      enrollment.id,
      'owner-1',
      'read-piloter',
    );
    expect(status.status).toBe('absent');
    expect(status.capabilityIds).toEqual([]);

    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'owner-1',
        correlationId: 'seed-active',
        reason: 'Force active for subset test',
      },
      async (db) => {
        await db
          .update(schema.clientEnrollments)
          .set({ state: 'active' })
          .where(eq(schema.clientEnrollments.id, enrollment.id));
      },
    );

    // Subset update without project-enabled tools fails closed.
    await expect(
      service.updatePiloterCapabilities(
        enrollment.id,
        ['create_blog_draft'],
        context('subset-unbound'),
      ),
    ).rejects.toMatchObject({
      metadata: { code: 'piloter_capability_not_bound' },
    });
  });
});
