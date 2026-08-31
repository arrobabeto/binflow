import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  runMigrations,
  schema,
  withPlatformOwnerScope,
} from '@binflow/db';

import { TicketService } from '../src/tickets.js';

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

describeDatabase('TicketService', () => {
  const database = createDatabase(databaseUrl!);
  const clock = { now: () => new Date('2026-08-31T12:00:00.000Z') };
  const service = new TicketService(database.db, clock);

  beforeAll(async () => runMigrations(databaseUrl!));
  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        ticket_activities,
        tickets,
        channel_identities,
        conversations,
        client_users,
        memberships,
        client_enrollments,
        idempotency_records,
        outbox_events,
        audit_events,
        provider_credentials,
        secret_references,
        projects,
        tenants
      restart identity cascade
    `);
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'ticket-fixture',
        reason: 'Seed ticket fixture',
      },
      async (scoped) => {
        await scoped.insert(schema.tenants).values({
          displayName: 'Webbin',
          id: 'tenant-webbin',
          key: 'webbin',
        });
        await scoped.insert(schema.projects).values({
          displayName: 'Webbin',
          id: 'project-webbin',
          key: 'webbin',
          tenantId: 'tenant-webbin',
        });
      },
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it('filters pending vs history and marks read idempotently', async () => {
    const empty = await service.list('owner-1', 'list-empty', {
      limit: 10,
      tab: 'pending',
    });
    expect(empty.items).toHaveLength(0);
    expect(empty.pendingCount).toBe(0);

    const created = await service.createTicket(
      {
        body: 'Please design a custom pricing table.',
        category: 'design',
        priority: 'high',
        projectId: 'project-webbin',
        tenantId: 'tenant-webbin',
        title: 'Custom pricing table',
      },
      'owner-1',
      'create-1',
    );
    expect(created.state).toBe('new');
    expect(created.readAt).toBeNull();
    expect(created.publicId.startsWith('TKT-')).toBe(true);

    await service.createTicket(
      {
        body: 'Closed ask',
        projectId: 'project-webbin',
        tenantId: 'tenant-webbin',
        title: 'Already closed',
      },
      'owner-1',
      'create-2',
    );
    const closedSeed = (
      await service.list('owner-1', 'list-for-close', {
        limit: 10,
        tab: 'pending',
      })
    ).items.find((item) => item.title === 'Already closed');
    expect(closedSeed).toBeDefined();
    await service.patch(
      closedSeed!.id,
      { state: 'closed' },
      closedSeed!.revision,
      'owner-1',
      'close-1',
      'idempotency-close-1xxxx',
    );

    const pending = await service.list('owner-1', 'list-pending', {
      limit: 10,
      tab: 'pending',
    });
    expect(pending.items.map((item) => item.title)).toEqual([
      'Custom pricing table',
    ]);
    expect(pending.pendingCount).toBe(1);

    const history = await service.list('owner-1', 'list-history', {
      limit: 10,
      tab: 'history',
    });
    expect(history.items.map((item) => item.title)).toEqual(['Already closed']);
    expect(history.pendingCount).toBe(1);

    const readOnce = await service.markRead(created.id, 'owner-1', 'read-1');
    expect(readOnce.readAt).toBe('2026-08-31T12:00:00.000Z');
    const readTwice = await service.markRead(created.id, 'owner-1', 'read-2');
    expect(readTwice.readAt).toBe('2026-08-31T12:00:00.000Z');

    await expect(
      service.sendMessage(
        created.id,
        'We will review this request.',
        'owner-1',
        'msg-unpaired',
        'idempotency-ticket-msg-01',
      ),
    ).rejects.toMatchObject({
      category: 'conflict_error',
      metadata: { code: 'client_not_paired' },
    });
  });

  it('queues ticket messages when the project is paired', async () => {
    const created = await service.createTicket(
      {
        body: 'Need help with a custom integration.',
        projectId: 'project-webbin',
        tenantId: 'tenant-webbin',
        title: 'Custom integration',
      },
      'owner-1',
      'create-paired',
    );
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'pair-ticket',
        reason: 'Pair channel for ticket message',
      },
      async (scoped) => {
        await scoped.insert(schema.clientEnrollments).values({
          configuration: {
            clientConversationLocale: 'es',
            contentLocales: ['es', 'en'],
            requiredLocales: ['es', 'en'],
            translationPolicy: 'always_translate',
          },
          id: 'enrollment-webbin',
          projectId: 'project-webbin',
          state: 'active',
          tenantId: 'tenant-webbin',
        });
        await scoped.insert(schema.clientUsers).values({
          displayName: 'Webbin client',
          enrollmentId: 'enrollment-webbin',
          id: 'client-webbin',
          projectId: 'project-webbin',
          tenantId: 'tenant-webbin',
        });
        await scoped.insert(schema.secretReferences).values({
          algorithm: 'aes-256-gcm',
          authTag: 'tag',
          ciphertext: 'ciphertext',
          credentialVersion: 1,
          id: 'telegram-secret-ticket',
          keyVersion: 1,
          nonce: 'nonce',
          provider: 'telegram-client',
          tenantId: 'tenant-webbin',
          wrapAuthTag: 'tag',
          wrappedDek: 'dek',
          wrapNonce: 'nonce',
        });
        await scoped.insert(schema.providerCredentials).values({
          alias: 'Client bot',
          configuration: { expectedUsername: 'TicketBot' },
          externalResourceId: '1000000002',
          id: 'telegram-client-ticket',
          kind: 'telegram-client',
          maskedSuffix: '0002',
          ownerScope: 'tenant',
          secretReferenceId: 'telegram-secret-ticket',
          status: 'active',
          tenantId: 'tenant-webbin',
          version: 1,
        });
        const now = new Date('2026-08-31T12:00:00.000Z');
        await scoped.insert(schema.channelIdentities).values({
          botCredentialId: 'telegram-client-ticket',
          botId: '1000000002',
          chatId: '2000000002',
          externalUserId: '3000000002',
          id: 'channel-ticket',
          lastSeenAt: now,
          projectId: 'project-webbin',
          status: 'active',
          tenantId: 'tenant-webbin',
          userId: 'client-webbin',
          verifiedAt: now,
        });
      },
    );

    const target = await service.getMessageTarget(
      created.id,
      'owner-1',
      'target-1',
    );
    expect(target).toEqual({
      botUsername: 'TicketBot',
      clientName: 'Webbin',
      paired: true,
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });

    const queued = await service.sendMessage(
      created.id,
      'Thanks — we opened a ticket.',
      'owner-1',
      'msg-paired',
      'idempotency-ticket-msg-02',
    );
    expect(queued).toEqual({
      notificationType: 'admin.ticket_message',
      queued: true,
    });

    const [event] = await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'read-outbox',
        reason: 'Assert ticket outbox aggregate',
      },
      async (scoped) =>
        scoped
          .select()
          .from(schema.outboxEvents)
          .where(eq(schema.outboxEvents.aggregateId, created.id))
          .limit(1),
    );
    expect(event?.aggregateType).toBe('ticket');
    expect(event?.eventType).toBe('client.notification_requested');
    expect(JSON.stringify(event?.payload)).not.toMatch(/chat/i);
    expect((event?.payload as { message?: string }).message).toMatch(
      /^Reply to ticket TKT-/u,
    );
    expect((event?.payload as { message?: string }).message).toContain(
      'Thanks — we opened a ticket.',
    );
  });
});
