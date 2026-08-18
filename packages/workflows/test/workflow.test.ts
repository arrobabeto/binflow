import { createHash } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  runMigrations,
  schema,
  withPlatformOwnerScope,
} from '@binflow/db';

import { WorkflowService } from '../src/index.js';

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
const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describeDatabase('Telegram request workflow kernel', () => {
  const database = createDatabase(databaseUrl!);
  const clock = { now: () => new Date('2026-08-18T12:00:00.000Z') };
  const service = new WorkflowService(database.db, clock);

  beforeAll(async () => runMigrations(databaseUrl!));
  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        workflow_checkpoints,
        graph_runs,
        request_actions,
        request_versions,
        requests,
        channel_messages,
        conversations,
        channel_identities,
        memberships,
        client_users,
        pairing_tokens,
        project_capability_bindings,
        project_budget_policies,
        project_locales,
        project_manifest_versions,
        enrollment_validation_attempts,
        client_enrollments,
        processed_events,
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
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'workflow-fixture',
        reason: 'Seed workflow fixture',
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
        await scoped.insert(schema.clientEnrollments).values({
          configuration: {
            clientConversationLocale: 'es',
            contentLocales: ['es', 'en'],
            requiredLocales: ['es', 'en'],
            translationPolicy: 'always_translate',
          },
          id: 'enrollment-webbin',
          projectId: 'project-webbin',
          state: 'pairing_pending',
          tenantId: 'tenant-webbin',
        });
        await scoped.insert(schema.clientUsers).values({
          displayName: 'Webbin client',
          enrollmentId: 'enrollment-webbin',
          id: 'client-webbin',
          projectId: 'project-webbin',
          tenantId: 'tenant-webbin',
        });
        await scoped.insert(schema.memberships).values({
          id: 'membership-webbin',
          projectId: 'project-webbin',
          tenantId: 'tenant-webbin',
          userId: 'client-webbin',
        });
        await scoped.insert(schema.secretReferences).values({
          algorithm: 'aes-256-gcm',
          authTag: 'tag',
          ciphertext: 'ciphertext',
          credentialVersion: 1,
          id: 'telegram-secret',
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
          externalResourceId: '8918222535',
          id: 'telegram-client',
          kind: 'telegram-client',
          maskedSuffix: '0000',
          ownerScope: 'tenant',
          secretReferenceId: 'telegram-secret',
          status: 'active',
          tenantId: 'tenant-webbin',
          version: 1,
        });
        await scoped.insert(schema.pairingTokens).values({
          botCredentialId: 'telegram-client',
          createdBy: 'owner',
          enrollmentId: 'enrollment-webbin',
          expiresAt: new Date('2026-08-19T00:00:00.000Z'),
          id: 'pairing-token',
          projectId: 'project-webbin',
          tenantId: 'tenant-webbin',
          tokenHash: tokenHash('pairing-token-abcdefghijklmnopqrstuvwxyz'),
          userId: 'client-webbin',
        });
        await scoped.insert(schema.projectManifestVersions).values({
          createdBy: 'owner',
          dependencyFingerprint: 'f'.repeat(64),
          document: {
            budgetPolicy: {
              maxEstimatedCostCentsPerDay: 2000,
              maxEstimatedCostCentsPerRequest: 500,
              maxModelCallsPerRequest: 12,
              maxRequestsPerDay: 10,
              maxTokensPerRequest: 120000,
            },
            content: {
              blockedPaths: ['.github/**'],
              collections: {
                en: {
                  directory: 'src/content/blog/en',
                  routePrefix: '/en/blog',
                },
                es: { directory: 'src/content/blog/es', routePrefix: '/blog' },
              },
              editablePaths: ['src/content/blog/**'],
              frontmatterFields: ['title'],
              imageDirectory: 'src/assets/blog',
              source: 'github',
            },
            contentLocales: ['es', 'en'],
            conversationLocale: 'es',
            defaultContentLocale: 'es',
            deployment: {
              previewMode: 'git_integration',
              projectId: 'vercel-project',
              protectionMode: 'public',
              provider: 'vercel',
            },
            enabledCapabilities: [
              {
                access: 'client_publish',
                capabilityId: 'create_blog_draft',
                capabilityVersion: 1,
              },
            ],
            fingerprint: 'f'.repeat(64),
            globalProfileVersion: '1',
            graphVersion: 'create_blog@1',
            id: 'manifest-webbin',
            profile: 'astro_repo',
            projectId: 'project-webbin',
            repository: {
              branchPattern: 'binflow/**',
              githubInstallationId: '1',
              name: 'webbin',
              owner: 'arrobabeto',
              productionBranch: 'main',
            },
            requiredContentLocales: ['es', 'en'],
            rulesVersion: '1',
            slugLocale: 'es',
            status: 'validated',
            translationPolicy: 'always_translate',
            validatedAt: '2026-08-18T00:00:00.000Z',
            validationProfileId: 'astro_repo',
            version: 1,
          },
          globalProfileVersion: '1',
          id: 'manifest-webbin',
          profile: 'astro_repo',
          projectId: 'project-webbin',
          status: 'validated',
          tenantId: 'tenant-webbin',
          validatedAt: new Date('2026-08-18T00:00:00.000Z'),
          version: 1,
        });
        await scoped.insert(schema.projectCapabilityBindings).values({
          access: 'client_publish',
          capabilityId: 'create_blog_draft',
          capabilityVersion: 1,
          createdBy: 'owner',
          id: 'binding-webbin',
          manifestVersionId: 'manifest-webbin',
          projectId: 'project-webbin',
          tenantId: 'tenant-webbin',
        });
      },
    );
  });
  afterAll(async () => database.pool.end());

  const update = (updateId: string, text: string, botId = '8918222535') => ({
    botId,
    chatId: '500',
    externalUserId: '100',
    receivedAt: '2026-08-18T12:00:00.000Z',
    text,
    updateId,
  });

  it('pairs once, isolates bot identities and denies replay', async () => {
    const paired = await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    expect(paired.text).toContain('Vinculación completada');
    const replay = await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    expect(replay.text).toContain('not paired');
    const wrongBot = await service.handleTelegramUpdate(
      update('2', '/tools', '8664708110'),
    );
    expect(wrongBot.text).toContain('not paired');
  });

  it('creates, confirms and durably queues an enabled request', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const tools = await service.handleTelegramUpdate(update('2', '/tools'));
    expect(tools.text).toContain('/create_blog');
    const plan = await service.handleTelegramUpdate(
      update('3', '/create_blog Automatización segura con IA'),
    );
    expect(plan.requestId).not.toBeNull();
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    const queued = await service.handleTelegramUpdate(
      update('4', `/action ${confirmation.token}`),
    );
    expect(queued.text).toContain('encolada');
    const [request] = await database.db.select().from(schema.requests);
    expect(request).toMatchObject({
      state: 'QUEUED',
      topic: 'Automatización segura con IA',
    });
    expect(await database.db.select().from(schema.graphRuns)).toHaveLength(1);
    expect(
      await database.db.select().from(schema.workflowCheckpoints),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.eventType, 'workflow.resume_requested')),
    ).toHaveLength(1);
    expect(
      JSON.stringify(await database.db.select().from(schema.requestActions)),
    ).not.toContain(confirmation.token);
  });

  it('does not create a request for an empty command and can cancel by opaque action', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const guidance = await service.handleTelegramUpdate(
      update('2', '/create_blog'),
    );
    expect(guidance.text).toContain('Requerido: un tema');
    expect(await database.db.select().from(schema.requests)).toHaveLength(0);
    const plan = await service.handleTelegramUpdate(
      update('3', 'Quiero un artículo sobre seguridad web'),
    );
    const cancellation = plan.actionTokens.find(
      (action) => action.action === 'cancel',
    )!;
    await service.handleTelegramUpdate(
      update('4', `/action ${cancellation.token}`),
    );
    const [request] = await database.db.select().from(schema.requests);
    expect(request?.state).toBe('CANCELLED');
  });
});
