import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DomainError } from '@binflow/domain';

import { createDatabase } from '../src/client.js';
import {
  completeIdempotencyRecord,
  createAdminOperation,
  hashCanonicalRequest,
  recordProcessedEvent,
  reserveIdempotencyKey,
  transitionAdminOperation,
} from '../src/control-plane.js';
import { runMigrations } from '../src/migrate.js';
import { ensureDraftScope } from '../src/repository.js';
import {
  adminOperations,
  auditEvents,
  outboxEvents,
  tenants,
} from '../src/schema.js';
import { withPlatformOwnerScope, withTenantScope } from '../src/scope.js';

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

describeDatabase('control-plane database foundation', () => {
  const owner = createDatabase(databaseUrl!);
  const runtimeUrl = new URL(databaseUrl!);
  runtimeUrl.username = 'binflow_app_test';
  runtimeUrl.password = 'binflow_test_app';
  const runtime = createDatabase(runtimeUrl.toString());

  beforeAll(async () => {
    await runMigrations(databaseUrl!);
    await owner.db.execute(sql`
      do $$
      begin
        if not exists (
          select 1 from pg_roles where rolname = 'binflow_app_test'
        ) then
          create role binflow_app_test
            login password 'binflow_test_app'
            nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
        end if;
      end
      $$
    `);
    await owner.db.execute(
      sql`grant usage on schema public to binflow_app_test`,
    );
    await owner.db.execute(
      sql`grant select, insert, update, delete on all tables in schema public to binflow_app_test`,
    );
    await owner.db.execute(
      sql`grant usage, select on all sequences in schema public to binflow_app_test`,
    );
  });

  beforeEach(async () => {
    await owner.db.execute(sql`
      truncate table
        processed_events,
        idempotency_records,
        outbox_events,
        admin_operations,
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

  afterAll(async () => {
    await runtime.pool.end();
    await owner.pool.end();
  });

  const createScope = (tenantKey: string, projectKey: string) =>
    withPlatformOwnerScope(
      runtime.db,
      {
        actorId: 'owner-1',
        correlationId: `setup-${tenantKey}`,
        reason: 'Test fixture setup',
      },
      (database) =>
        ensureDraftScope(database, {
          projectKey,
          tenantKey,
        }),
    );

  it('enforces tenant RLS through a non-owner runtime role', async () => {
    const first = await createScope('first', 'site');
    await createScope('second', 'site');

    const visible = await withTenantScope(
      runtime.db,
      first.tenantId,
      (database) => database.select().from(tenants),
    );

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(first.tenantId);
    await expect(runtime.db.select().from(tenants)).resolves.toEqual([]);
  });

  it('audits every explicit platform-owner scope', async () => {
    await createScope('webbin', 'webbin');

    const rows = await owner.db.select().from(auditEvents);
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'platform.scope_accessed',
        actorId: 'owner-1',
        actorType: 'platform_owner',
        reason: 'Test fixture setup',
      }),
    ]);
  });

  it('keeps audit events append-only at the database boundary', async () => {
    await createScope('webbin', 'webbin');
    const event = (await owner.db.select().from(auditEvents))[0];
    expect(event).toBeDefined();
    await expect(
      owner.db
        .update(auditEvents)
        .set({ reason: 'changed' })
        .where(eq(auditEvents.id, event!.id)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('audit_events are append-only'),
      }),
    });
    await expect(
      owner.db.delete(auditEvents).where(eq(auditEvents.id, event!.id)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining('audit_events are append-only'),
      }),
    });
  });

  it('serializes concurrent idempotency reservations', async () => {
    const scope = await createScope('webbin', 'webbin');
    const input = {
      actorId: 'owner-1',
      expiresAt: new Date('2026-09-17T00:00:00.000Z'),
      idempotencyKey: 'concurrent-request-0001',
      method: 'POST',
      projectId: scope.projectId,
      requestHash: hashCanonicalRequest({ project: 'webbin' }),
      route: '/api/v1/admin/enrollments',
      tenantId: scope.tenantId,
    } as const;
    const reserve = (correlationId: string) =>
      withPlatformOwnerScope(
        runtime.db,
        {
          actorId: 'owner-1',
          correlationId,
          reason: 'Concurrent reservation test',
        },
        (database) => reserveIdempotencyKey(database, input),
      );

    const results = await Promise.all([reserve('race-1'), reserve('race-2')]);
    expect(results.map((result) => result.kind).sort()).toEqual([
      'replay',
      'reserved',
    ]);
  });

  it('binds an idempotency key to one canonical request', async () => {
    const scope = await createScope('webbin', 'webbin');
    const requestHash = hashCanonicalRequest({
      displayName: 'Webbin',
      locales: ['es', 'en'],
    });

    await withPlatformOwnerScope(
      runtime.db,
      {
        actorId: 'owner-1',
        correlationId: 'request-1',
        reason: 'Create enrollment operation',
      },
      async (database) => {
        const reservation = await reserveIdempotencyKey(database, {
          actorId: 'owner-1',
          expiresAt: new Date('2026-09-17T00:00:00.000Z'),
          idempotencyKey: 'enrollment-request-0001',
          method: 'POST',
          projectId: scope.projectId,
          requestHash,
          route: '/api/v1/admin/enrollments',
          tenantId: scope.tenantId,
        });
        expect(reservation.kind).toBe('reserved');
        if (reservation.kind !== 'reserved') return;

        const operation = await createAdminOperation(database, {
          actorId: 'owner-1',
          aggregateId: scope.projectId,
          aggregateType: 'project',
          auditAction: 'enrollment.validation_requested',
          correlationId: 'request-1',
          eventType: 'admin.operation.requested',
          inputHash: requestHash,
          payload: { projectId: scope.projectId },
          projectId: scope.projectId,
          tenantId: scope.tenantId,
          type: 'enrollment.validate',
        });
        await completeIdempotencyRecord(database, {
          id: reservation.id,
          operationId: operation.operationId,
          responseBody: {
            operationId: operation.operationId,
            status: 'pending',
          },
          responseStatus: 202,
          status: 'completed',
        });
      },
    );

    await withPlatformOwnerScope(
      runtime.db,
      {
        actorId: 'owner-1',
        correlationId: 'request-1-retry',
        reason: 'Replay enrollment operation',
      },
      async (database) => {
        await expect(
          reserveIdempotencyKey(database, {
            actorId: 'owner-1',
            expiresAt: new Date('2026-09-17T00:00:00.000Z'),
            idempotencyKey: 'enrollment-request-0001',
            method: 'POST',
            projectId: scope.projectId,
            requestHash,
            route: '/api/v1/admin/enrollments',
            tenantId: scope.tenantId,
          }),
        ).resolves.toMatchObject({ kind: 'replay', responseStatus: 202 });
        await expect(
          reserveIdempotencyKey(database, {
            actorId: 'owner-1',
            expiresAt: new Date('2026-09-17T00:00:00.000Z'),
            idempotencyKey: 'enrollment-request-0001',
            method: 'POST',
            projectId: scope.projectId,
            requestHash: hashCanonicalRequest({ displayName: 'Other' }),
            route: '/api/v1/admin/enrollments',
            tenantId: scope.tenantId,
          }),
        ).rejects.toBeInstanceOf(DomainError);
      },
    );

    expect(await owner.db.select().from(adminOperations)).toHaveLength(1);
    expect(await owner.db.select().from(outboxEvents)).toHaveLength(1);
  });

  it('rolls operation, audit and outbox back atomically', async () => {
    const scope = await createScope('webbin', 'webbin');
    const initialAuditCount = (await owner.db.select().from(auditEvents))
      .length;

    await expect(
      withPlatformOwnerScope(
        runtime.db,
        {
          actorId: 'owner-1',
          correlationId: 'rollback-1',
          reason: 'Rollback test',
        },
        async (database) => {
          await createAdminOperation(database, {
            actorId: 'owner-1',
            aggregateId: scope.projectId,
            aggregateType: 'project',
            auditAction: 'operation.created',
            correlationId: 'rollback-1',
            eventType: 'operation.created',
            inputHash: hashCanonicalRequest({ test: true }),
            payload: {},
            projectId: scope.projectId,
            tenantId: scope.tenantId,
            type: 'test.rollback',
          });
          throw new Error('force rollback');
        },
      ),
    ).rejects.toThrow('force rollback');

    expect(await owner.db.select().from(adminOperations)).toHaveLength(0);
    expect(await owner.db.select().from(outboxEvents)).toHaveLength(0);
    expect(await owner.db.select().from(auditEvents)).toHaveLength(
      initialAuditCount,
    );
  });

  it('enforces optimistic administrative operation transitions', async () => {
    const scope = await createScope('webbin', 'webbin');
    let operationId = '';
    await withPlatformOwnerScope(
      runtime.db,
      {
        actorId: 'owner-1',
        correlationId: 'operation-state-1',
        reason: 'Operation state test',
      },
      async (database) => {
        const created = await createAdminOperation(database, {
          actorId: 'owner-1',
          aggregateId: scope.projectId,
          aggregateType: 'project',
          auditAction: 'operation.created',
          correlationId: 'operation-state-1',
          eventType: 'operation.created',
          inputHash: hashCanonicalRequest({ validate: true }),
          payload: {},
          projectId: scope.projectId,
          tenantId: scope.tenantId,
          type: 'enrollment.validate',
        });
        operationId = created.operationId;
        await transitionAdminOperation(database, {
          expectedVersion: 1,
          operationId,
          progress: 10,
          status: 'running',
        });
        await expect(
          transitionAdminOperation(database, {
            error: { category: 'provider_final', code: 'stale-result' },
            expectedVersion: 1,
            operationId,
            progress: 10,
            status: 'failed',
          }),
        ).rejects.toMatchObject({ category: 'conflict_error' });
        await transitionAdminOperation(database, {
          expectedVersion: 2,
          operationId,
          progress: 100,
          result: { validation: 'passed' },
          status: 'succeeded',
        });
      },
    );

    await expect(
      owner.db.query.adminOperations.findFirst({
        where: eq(adminOperations.id, operationId),
      }),
    ).resolves.toMatchObject({
      progress: 100,
      result: { validation: 'passed' },
      status: 'succeeded',
      version: 3,
    });
  });

  it('deduplicates consumer event processing', async () => {
    const scope = await createScope('webbin', 'webbin');
    await withTenantScope(runtime.db, scope.tenantId, async (database) => {
      await expect(
        recordProcessedEvent(database, {
          consumer: 'workflow-worker',
          eventKey: 'event-1',
          projectId: scope.projectId,
          result: { accepted: true },
          tenantId: scope.tenantId,
        }),
      ).resolves.toBe('processed');
      await expect(
        recordProcessedEvent(database, {
          consumer: 'workflow-worker',
          eventKey: 'event-1',
          projectId: scope.projectId,
          result: { accepted: true },
          tenantId: scope.tenantId,
        }),
      ).resolves.toBe('duplicate');
    });
  });
});
