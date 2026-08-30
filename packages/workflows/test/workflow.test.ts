import { createHash } from 'node:crypto';

import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabase,
  runMigrations,
  schema,
  withPlatformOwnerScope,
} from '@binflow/db';
import { MemoryArtifactStore } from '@binflow/artifacts';
import type { BlogExecutor } from '@binflow/blog';
import { DomainError } from '@binflow/domain';

import {
  BlogWorkflowRuntime,
  mapBlogBriefInput,
  matchesNaturalProject,
  WorkflowService,
} from '../src/index.js';

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

describe('mapBlogBriefInput', () => {
  it('keeps short text as topic only', () => {
    expect(mapBlogBriefInput('Automatización con IA', 'es')).toEqual({
      kind: 'ok',
      topic: 'Automatización con IA',
    });
  });

  it('stores the full long message in context with a provisional topic', () => {
    const raw = `${'palabra '.repeat(80)}contexto extra para el artículo`.trim();
    expect(raw.length).toBeGreaterThan(500);
    const result = mapBlogBriefInput(raw, 'es');
    expect(result).toEqual({
      kind: 'ok',
      topic: 'Tema por definir desde tu mensaje',
      context: raw,
    });
  });

  it('rejects only when the message exceeds the context limit', () => {
    const raw = `tema ${'x'.repeat(10_600)}`;
    expect(mapBlogBriefInput(raw, 'en')).toEqual({ kind: 'too_long' });
  });
});

describe('matchesNaturalProject', () => {
  it('matches portfolio keywords', () => {
    expect(
      matchesNaturalProject('Quiero agregar un proyecto de portafolio nuevo'),
    ).toBe(true);
  });

  it('matches brief-style cues without slash command', () => {
    expect(
      matchesNaturalProject(
        'Plataforma de reservas para escuela de idiomas online. Stack: Astro, Stripe. Rol: diseño + frontend. Estado: Publicado. Cliente confidencial.',
      ),
    ).toBe(true);
  });

  it('ignores generic text without project signals', () => {
    expect(matchesNaturalProject('Hola, ¿cómo estás?')).toBe(false);
  });
});

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
          lastValidatedAt: new Date('2026-08-18T11:59:00.000Z'),
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
          externalResourceId: '1000000001',
          id: 'telegram-client',
          kind: 'telegram-client',
          maskedSuffix: '0000',
          ownerScope: 'tenant',
          secretReferenceId: 'telegram-secret',
          status: 'active',
          tenantId: 'tenant-webbin',
          version: 1,
        });
        await scoped.insert(schema.secretReferences).values({
          algorithm: 'aes-256-gcm',
          authTag: 'tag',
          ciphertext: 'ciphertext',
          credentialVersion: 1,
          id: 'telegram-admin-secret',
          keyVersion: 1,
          nonce: 'nonce',
          provider: 'telegram-admin',
          wrapAuthTag: 'tag',
          wrappedDek: 'dek',
          wrapNonce: 'nonce',
        });
        await scoped.insert(schema.providerCredentials).values({
          alias: 'Admin bot',
          configuration: {
            expectedUsername: 'BinflowAdminFixture_bot',
            role: 'admin',
          },
          externalResourceId: '1000000002',
          id: 'telegram-admin',
          kind: 'telegram-admin',
          maskedSuffix: '0000',
          ownerScope: 'platform',
          secretReferenceId: 'telegram-admin-secret',
          status: 'active',
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
            graphVersion: 'stacks/astro-repo/create-blog@1',
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
        await scoped.insert(schema.enrollmentValidationAttempts).values(
          [
            'configuration',
            'openai_credential',
            'telegram_admin_credential',
            'telegram_client_credential',
            'github_app_binding',
            'vercel_binding',
            'project_manifest',
            'capability_catalog',
          ].map((checkName, index) => ({
            checkName,
            checkVersion: 1,
            checkedAt: new Date('2026-08-18T12:00:00.000Z'),
            dependencyFingerprint: 'a'.repeat(64),
            enrollmentId: 'enrollment-webbin',
            evidence: { ready: true },
            id: `validation-${String(index)}`,
            projectId: 'project-webbin',
            result: 'success' as const,
            tenantId: 'tenant-webbin',
          })),
        );
      },
    );
  });
  afterAll(async () => database.pool.end());

  const update = (updateId: string, text: string, botId = '1000000001') => ({
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
    expect(replay.text).toContain('Vinculación completada');
    const wrongBot = await service.handleTelegramUpdate(
      update('2', '/tools', '1000000002'),
    );
    expect(wrongBot.text).toContain('not paired');
  });

  it('activates the enrollment only after the pairing reply is delivered', async () => {
    const pairingUpdate = update(
      '1',
      '/start pairing-token-abcdefghijklmnopqrstuvwxyz',
    );
    await service.handleTelegramUpdate(pairingUpdate);
    expect(
      (await database.db.select().from(schema.clientEnrollments))[0],
    ).toMatchObject({ state: 'pairing_pending', version: 1 });

    await service.confirmTelegramReplyDelivered(pairingUpdate);
    expect(
      (await database.db.select().from(schema.clientEnrollments))[0],
    ).toMatchObject({ state: 'active', version: 2 });
    expect(
      await database.db
        .select()
        .from(schema.enrollmentValidationAttempts)
        .where(
          eq(
            schema.enrollmentValidationAttempts.checkName,
            'telegram_test_send',
          ),
        ),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, 'enrollment.activated')),
    ).toHaveLength(1);

    await service.confirmTelegramReplyDelivered(pairingUpdate);
    expect(
      (await database.db.select().from(schema.clientEnrollments))[0],
    ).toMatchObject({ state: 'active', version: 2 });
  });

  it('pairs the global admin target once with a hash-only owner challenge', async () => {
    const link = await service.createAdminPairingLink(
      'owner-1',
      'admin-pairing',
      'admin-pairing-key-0001',
    );
    const token = new URL(link.pairingUrl).searchParams.get('start');
    expect(token).not.toBeNull();
    const paired = await service.handleAdminTelegramUpdate(
      update('901', `/start ${token}`, '1000000002'),
    );
    expect(paired.text).toContain('paired successfully');
    const target = await service.getAdminTelegramTarget(
      'owner-1',
      'admin-target',
    );
    expect(target).toMatchObject({
      botId: '1000000002',
      externalUserId: '100',
      status: 'active',
    });
    const replay = await service.handleAdminTelegramUpdate(
      update('902', `/start ${token}`, '1000000002'),
    );
    expect(replay.text).toContain('not paired');
    expect(
      JSON.stringify(
        await database.db.select().from(schema.adminPairingTokens),
      ),
    ).not.toContain(token);
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

  it('queues interpret_revision from free-text feedback after request changes', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Título más atractivo'),
    );
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    await service.handleTelegramUpdate(
      update('3', `/action ${confirmation.token}`),
    );
    const [request] = await database.db.select().from(schema.requests);
    expect(request).toBeDefined();
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'test',
        correlationId: 'revision-feedback',
        reason: 'Seed revision requested',
      },
      async (scoped) => {
        await scoped
          .update(schema.requests)
          .set({ state: 'REVISION_REQUESTED' })
          .where(eq(schema.requests.id, request!.id));
      },
    );
    const feedback = await service.handleTelegramUpdate(
      update('4', 'Haz el título más atractivo sin cambiar el cuerpo'),
    );
    expect(feedback.text).toContain('plan de cambio');
    const resumes = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, 'workflow.resume_requested'));
    expect(
      resumes.some(
        (event) =>
          (event.payload as { reason?: string }).reason ===
          'interpret_revision',
      ),
    ).toBe(true);
    const [updated] = await database.db.select().from(schema.requests);
    expect(updated?.state).toBe('QUEUED');
    expect(updated?.currentVersion).toBe(2);
  });

  it('stores a long client brief intact in context with a provisional topic', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const brief = `Quiero un artículo sobre automatización de blogs con tools agénticas. ${'detalle '.repeat(80)}Fin del brief.`;
    expect(brief.length).toBeGreaterThan(500);
    const plan = await service.handleTelegramUpdate(update('2', brief));
    expect(plan.requestId).not.toBeNull();
    const [request] = await database.db.select().from(schema.requests);
    const [version] = await database.db.select().from(schema.requestVersions);
    expect(request?.topic).toBe('Tema por definir desde tu mensaje');
    expect(version?.interpretedInput).toMatchObject({
      context: brief,
      mode: 'brief',
      topic: 'Tema por definir desde tu mensaje',
    });
    expect(
      (version?.interpretedInput as { context?: string }).context,
    ).toBe(brief);
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
    expect(
      await database.db
        .select()
        .from(schema.outboxEvents)
        .where(
          eq(schema.outboxEvents.eventType, 'client.notification_requested'),
        ),
    ).toHaveLength(0);
  });

  it('notifies the client once in its locale when the owner cancels', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Automatización segura con IA'),
    );
    const [created] = await database.db.select().from(schema.requests);
    const cancelled = await service.cancelAsAdmin(
      plan.requestId!,
      created!.version,
      'admin:owner',
      'correlation-cancel',
      'idempotency-cancel',
    );
    expect(cancelled.state).toBe('CANCELLED');
    const notices = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(
        eq(schema.outboxEvents.eventType, 'client.notification_requested'),
      );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      aggregateId: plan.requestId,
      aggregateType: 'request',
      payload: {
        message: 'La solicitud fue cancelada.',
        notificationType: 'request.cancelled',
        requestId: plan.requestId,
      },
      projectId: 'project-webbin',
      status: 'pending',
      tenantId: 'tenant-webbin',
    });
    const adminNotices = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, 'admin.notification_requested'));
    expect(
      adminNotices.filter(
        (event) =>
          (event.payload as { notificationType?: string }).notificationType ===
          'request.cancelled',
      ),
    ).toHaveLength(0);
    await service.cancelAsAdmin(
      plan.requestId!,
      created!.version,
      'admin:owner',
      'correlation-cancel',
      'idempotency-cancel',
    );
    expect(
      await database.db
        .select()
        .from(schema.outboxEvents)
        .where(
          eq(schema.outboxEvents.eventType, 'client.notification_requested'),
        ),
    ).toHaveLength(1);
  });

  it('cancels without a notice when the conversation locale is unsupported', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Automatización segura con IA'),
    );
    const [created] = await database.db.select().from(schema.requests);
    await database.db.execute(sql`update conversations set locale = 'fr'`);
    const cancelled = await service.cancelAsAdmin(
      plan.requestId!,
      created!.version,
      'admin:owner',
      'correlation-cancel',
      'idempotency-cancel',
    );
    expect(cancelled.state).toBe('CANCELLED');
    expect(
      await database.db
        .select()
        .from(schema.outboxEvents)
        .where(
          eq(schema.outboxEvents.eventType, 'client.notification_requested'),
        ),
    ).toHaveLength(0);
  });

  it('binds preview approval to evidence and completes an idempotent fake publication', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Seguridad operativa con IA'),
    );
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    await service.handleTelegramUpdate(
      update('3', `/action ${confirmation.token}`),
    );
    const [request] = await database.db.select().from(schema.requests);
    const [version] = await database.db.select().from(schema.requestVersions);
    expect(request).toBeDefined();
    expect(version).toBeDefined();
    const markdown = new TextEncoder().encode('---\ntitulo: Test\n---\nBody');
    const image = new Uint8Array([1, 2, 3]);
    const fakeExecutor = {
      execute: async () => ({
        bundle: {
          category: 'SOP',
          categoryKind: 'existing' as const,
          en: {},
          es: { titulo: 'Seguridad operativa con IA' },
          imagePrompt: 'cover',
          rationale: {},
          slug: 'seguridad-operativa-con-ia',
        },
        catalog: [],
        catalogRevision: 'catalog-sha',
        deployment: {
          deploymentId: 'preview-1',
          environment: 'preview' as const,
          readyAt: clock.now().toISOString(),
          sha: 'abcdef1234567',
          urls: {
            '/articulos/seguridad-operativa-con-ia':
              'https://preview.example/articulos/seguridad-operativa-con-ia',
            '/es/articulos/seguridad-operativa-con-ia':
              'https://preview.example/es/articulos/seguridad-operativa-con-ia',
          },
        },
        files: [
          {
            bytes: markdown,
            mime: 'text/markdown' as const,
            path: 'src/content/articulos-es/seguridad-operativa-con-ia.md',
            sha256: 'a'.repeat(64),
          },
          {
            bytes: markdown,
            mime: 'text/markdown' as const,
            path: 'src/content/articulos/seguridad-operativa-con-ia.md',
            sha256: 'b'.repeat(64),
          },
          {
            bytes: image,
            mime: 'image/avif' as const,
            path: 'public/images/articles/seguridad-operativa-con-ia.avif',
            sha256: 'c'.repeat(64),
          },
        ],
        intent: 'Seguridad operativa con IA',
        publication: {
          baseCommitSha: 'base1234567',
          branch: `binflow/create-blog/${request!.id}`,
          files: [
            'src/content/articulos-es/seguridad-operativa-con-ia.md',
            'src/content/articulos/seguridad-operativa-con-ia.md',
            'public/images/articles/seguridad-operativa-con-ia.avif',
          ],
          headCommitSha: 'abcdef1234567',
          pullRequestId: '101',
          pullRequestUrl: 'https://github.com/arrobabeto/webbin/pull/101',
        },
        similarity: { candidates: [], level: 'novel' as const },
      }),
      publish: async () => ({
        deployment: {
          deploymentId: 'production-1',
          environment: 'production' as const,
          readyAt: clock.now().toISOString(),
          sha: 'merge1234567',
          urls: {
            '/articulos/seguridad-operativa-con-ia':
              'https://webbin.com.mx/articulos/seguridad-operativa-con-ia',
            '/es/articulos/seguridad-operativa-con-ia':
              'https://webbin.com.mx/es/articulos/seguridad-operativa-con-ia',
          },
        },
        mergeCommitSha: 'merge1234567',
      }),
      mergeApprovedPreview: async () => ({ mergeCommitSha: 'merge1234567' }),
      verifyProduction: async () => ({
        deployment: {
          deploymentId: 'production-1',
          environment: 'production' as const,
          readyAt: clock.now().toISOString(),
          sha: 'merge1234567',
          urls: {
            '/articulos/seguridad-operativa-con-ia':
              'https://webbin.com.mx/articulos/seguridad-operativa-con-ia',
            '/es/articulos/seguridad-operativa-con-ia':
              'https://webbin.com.mx/es/articulos/seguridad-operativa-con-ia',
          },
        },
        mergeCommitSha: 'merge1234567',
      }),
    } as unknown as BlogExecutor;
    const artifacts = new MemoryArtifactStore();
    const runtime = new BlogWorkflowRuntime(
      database.db,
      artifacts,
      fakeExecutor,
      clock,
    );
    const executed = await runtime.execute({
      reason: 'execute',
      requestId: request!.id,
      requestVersionId: version!.id,
      tenantId: request!.tenantId,
    });
    expect(artifacts.values).toHaveLength(3);
    const approved = await service.handleTelegramUpdate(
      update('4', `/action ${executed.actions.approve}`),
    );
    expect(approved.text).toContain('encolada');
    await runtime.publish({
      reason: 'publish',
      requestId: request!.id,
      requestVersionId: version!.id,
      tenantId: request!.tenantId,
    });
    const [completed] = await database.db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, request!.id));
    expect(completed?.state).toBe('COMPLETED');
    expect(await database.db.select().from(schema.approvals)).toHaveLength(1);
    expect(
      await database.db.select().from(schema.publicationAttempts),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(schema.similarityChecks),
    ).toHaveLength(1);
  });

  it('records stage checkpoints, failure detail and admin notification on execute failure', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Fallo de validación EN'),
    );
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    await service.handleTelegramUpdate(
      update('3', `/action ${confirmation.token}`),
    );
    const [request] = await database.db.select().from(schema.requests);
    const [version] = await database.db.select().from(schema.requestVersions);
    expect(request).toBeDefined();
    expect(version).toBeDefined();
    const failingExecutor = {
      execute: async (input: { onStage?: (node: string) => Promise<void> }) => {
        await input.onStage?.('catalog_sync');
        await input.onStage?.('generate');
        throw new DomainError(
          'policy_denied',
          'English article copied Spanish title.',
        );
      },
      publish: async () => {
        throw new DomainError('internal_error', 'Unexpected publish.');
      },
      mergeApprovedPreview: async () => ({ mergeCommitSha: 'merge1234567' }),
      verifyProduction: async () => ({
        deployment: {
          deploymentId: 'production-1',
          environment: 'production' as const,
          readyAt: clock.now().toISOString(),
          sha: 'merge1234567',
          urls: {},
        },
        mergeCommitSha: 'merge1234567',
      }),
    } as unknown as BlogExecutor;
    const runtime = new BlogWorkflowRuntime(
      database.db,
      new MemoryArtifactStore(),
      failingExecutor,
      clock,
    );
    await expect(
      runtime.execute({
        reason: 'execute',
        requestId: request!.id,
        requestVersionId: version!.id,
        tenantId: request!.tenantId,
      }),
    ).rejects.toThrow('English article copied Spanish title.');
    const [failed] = await database.db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, request!.id));
    expect(failed?.state).toBe('FAILED_FINAL');
    expect(failed?.terminalResult).toMatchObject({
      errorCategory: 'policy_denied',
      errorMessage: 'English article copied Spanish title.',
      failedNode: 'generate',
    });
    const checkpoints = await database.db
      .select()
      .from(schema.workflowCheckpoints)
      .orderBy(asc(schema.workflowCheckpoints.sequence));
    expect(checkpoints.map((checkpoint) => checkpoint.node)).toEqual([
      'plan_confirmed',
      'catalog_sync',
      'generate',
      'failed',
    ]);
    const notifications = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, 'admin.notification_requested'));
    const failedNotification = notifications.find(
      (event) =>
        (event.payload as { notificationType?: string }).notificationType ===
        'request.failed_final',
    );
    expect(failedNotification?.payload).toMatchObject({
      notificationType: 'request.failed_final',
      requestId: request!.id,
    });
    expect(JSON.stringify(failedNotification?.payload)).toContain('generate');
    expect(JSON.stringify(failedNotification?.payload)).toContain(
      'English article copied Spanish title.',
    );
    const detail = await service.get(request!.id, 'owner-1', 'request-detail');
    expect(detail.failure).toMatchObject({
      category: 'policy_denied',
      message: 'English article copied Spanish title.',
      node: 'generate',
    });
    expect(detail.stages.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(detail.stages)).not.toContain('apiKey');
    expect(JSON.stringify(detail.stages)).not.toContain('chainOfThought');
    const [graphRun] = await database.db.select().from(schema.graphRuns);
    await database.db.insert(schema.workflowCheckpoints).values({
      graphRunId: graphRun!.id,
      id: 'checkpoint-secret',
      node: 'generate',
      projectId: request!.projectId,
      sequence: checkpoints.at(-1)!.sequence + 1,
      state: {
        apiKey: 'secret-value',
        chainOfThought: 'hidden reasoning',
        requestState: 'GENERATING',
      },
      tenantId: request!.tenantId,
    });
    const redacted = await service.get(
      request!.id,
      'owner-1',
      'request-detail-redacted',
    );
    expect(JSON.stringify(redacted.stages)).not.toContain('secret-value');
    expect(JSON.stringify(redacted.stages)).not.toContain('hidden reasoning');
    expect(redacted.stages.at(-1)?.summary).toBe('GENERATING');
  });

  it('appends checkpoint sequences on retryable execute without unique collisions', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Reintento de proveedor'),
    );
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    await service.handleTelegramUpdate(
      update('3', `/action ${confirmation.token}`),
    );
    const [request] = await database.db.select().from(schema.requests);
    const [version] = await database.db.select().from(schema.requestVersions);
    let attempts = 0;
    const retryingExecutor = {
      execute: async (input: { onStage?: (node: string) => Promise<void> }) => {
        attempts += 1;
        await input.onStage?.('catalog_sync');
        if (attempts === 1)
          throw new DomainError(
            'provider_retryable',
            'Catalog sync timed out.',
          );
        await input.onStage?.('generate');
        throw new DomainError(
          'policy_denied',
          'A published article already has high topic overlap.',
        );
      },
      publish: async () => {
        throw new DomainError('internal_error', 'Unexpected publish.');
      },
      mergeApprovedPreview: async () => ({ mergeCommitSha: 'merge1234567' }),
      verifyProduction: async () => ({
        deployment: {
          deploymentId: 'production-1',
          environment: 'production' as const,
          readyAt: clock.now().toISOString(),
          sha: 'merge1234567',
          urls: {},
        },
        mergeCommitSha: 'merge1234567',
      }),
    } as unknown as BlogExecutor;
    const runtime = new BlogWorkflowRuntime(
      database.db,
      new MemoryArtifactStore(),
      retryingExecutor,
      clock,
    );
    await expect(
      runtime.execute({
        reason: 'execute',
        requestId: request!.id,
        requestVersionId: version!.id,
        tenantId: request!.tenantId,
      }),
    ).rejects.toThrow('Catalog sync timed out.');
    await expect(
      runtime.execute({
        reason: 'execute',
        requestId: request!.id,
        requestVersionId: version!.id,
        tenantId: request!.tenantId,
      }),
    ).rejects.toThrow('A published article already has high topic overlap.');
    const checkpoints = await database.db
      .select()
      .from(schema.workflowCheckpoints)
      .orderBy(asc(schema.workflowCheckpoints.sequence));
    expect(checkpoints.map((checkpoint) => checkpoint.sequence)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(checkpoints.map((checkpoint) => checkpoint.node)).toEqual([
      'plan_confirmed',
      'catalog_sync',
      'failed',
      'catalog_sync',
      'generate',
      'failed',
    ]);
    const failedFinal = (
      await database.db
        .select()
        .from(schema.outboxEvents)
        .where(
          eq(schema.outboxEvents.eventType, 'admin.notification_requested'),
        )
    ).filter(
      (event) =>
        (event.payload as { notificationType?: string }).notificationType ===
        'request.failed_final',
    );
    expect(failedFinal).toHaveLength(1);
  });

  it('lists requests by approval need, project, client name and cursor', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Listado de inbox'),
    );
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    await service.handleTelegramUpdate(
      update('3', `/action ${confirmation.token}`),
    );
    const [seed] = await database.db.select().from(schema.requests);
    expect(seed).toBeDefined();
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'request-list-seed',
        reason: 'Seed request inbox rows',
      },
      async (scoped) => {
        for (const index of Array.from({ length: 11 }, (_, value) => value)) {
          await scoped.insert(schema.requests).values({
            capabilityId: 'create_blog_draft',
            conversationId: seed!.conversationId,
            currentVersion: 1,
            id: `request-inbox-${String(index)}`,
            projectId: seed!.projectId,
            state: index === 0 ? 'AWAITING_ADMIN_APPROVAL' : 'QUEUED',
            tenantId: seed!.tenantId,
            topic: `Inbox topic ${String(index)}`,
            updatedAt: new Date(
              `2026-08-18T12:${String(index).padStart(2, '0')}:00.000Z`,
            ),
            userId: seed!.userId,
            version: 1,
          });
        }
      },
    );
    const approval = await service.list('owner-1', 'list-approval', {
      limit: 10,
      needsAdminApproval: true,
    });
    expect(approval.items).toHaveLength(1);
    expect(approval.items[0]).toMatchObject({
      clientKey: 'webbin',
      clientName: 'Webbin',
      state: 'AWAITING_ADMIN_APPROVAL',
    });
    expect(JSON.stringify(approval)).not.toContain('secret-value');
    const firstOther = await service.list('owner-1', 'list-other-1', {
      limit: 10,
      needsAdminApproval: false,
      projectId: seed!.projectId,
    });
    expect(firstOther.items).toHaveLength(10);
    expect(firstOther.nextCursor).not.toBeNull();
    expect(
      firstOther.items.every(
        (item) => item.state !== 'AWAITING_ADMIN_APPROVAL',
      ),
    ).toBe(true);
    const secondOther = await service.list('owner-1', 'list-other-2', {
      cursor: firstOther.nextCursor!,
      limit: 10,
      needsAdminApproval: false,
      projectId: seed!.projectId,
    });
    const firstIds = new Set(firstOther.items.map((item) => item.id));
    expect(secondOther.items.every((item) => !firstIds.has(item.id))).toBe(
      true,
    );
    expect(secondOther.items.length).toBeGreaterThan(0);
    const missingProject = await service.list('owner-1', 'list-missing', {
      limit: 10,
      projectId: 'project-missing',
    });
    expect(missingProject.items).toHaveLength(0);
    const detail = await service.get(seed!.id, 'owner-1', 'list-detail');
    expect(detail.clientName).toBe('Webbin');
    expect(detail.clientKey).toBe('webbin');
  });

  it('queues enrollment and request admin messages with pairing gates', async () => {
    await expect(
      service.sendEnrollmentMessage(
        'enrollment-webbin',
        'Please check your catalog.',
        'admin:owner',
        'correlation-enroll-msg-unpaired',
        'idempotency-enroll-msg-unpaired',
      ),
    ).rejects.toMatchObject({
      category: 'conflict_error',
      metadata: { code: 'client_not_paired' },
    });

    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'client-bot-username',
        reason: 'Set client bot username for message target',
      },
      async (scoped) => {
        await scoped
          .update(schema.providerCredentials)
          .set({
            configuration: { expectedUsername: 'WebbinClientBot' },
          })
          .where(eq(schema.providerCredentials.id, 'telegram-client'));
      },
    );

    const target = await service.getEnrollmentMessageTarget(
      'enrollment-webbin',
      'admin:owner',
      'correlation-enroll-target',
    );
    expect(target).toEqual({
      botUsername: 'WebbinClientBot',
      clientName: 'Webbin',
      paired: true,
      projectKey: 'webbin',
      tenantKey: 'webbin',
    });
    expect(JSON.stringify(target)).not.toMatch(/chat/i);

    const queued = await service.sendEnrollmentMessage(
      'enrollment-webbin',
      'Please check your catalog.',
      'admin:owner',
      'correlation-enroll-msg',
      'idempotency-enroll-msg',
    );
    expect(queued).toEqual({
      notificationType: 'admin.direct_message',
      queued: true,
    });
    const replay = await service.sendEnrollmentMessage(
      'enrollment-webbin',
      'Please check your catalog.',
      'admin:owner',
      'correlation-enroll-msg-replay',
      'idempotency-enroll-msg',
    );
    expect(replay).toEqual(queued);

    const notices = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(
        eq(schema.outboxEvents.eventType, 'client.notification_requested'),
      );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      aggregateId: 'enrollment-webbin',
      aggregateType: 'enrollment',
      payload: {
        enrollmentId: 'enrollment-webbin',
        notificationType: 'admin.direct_message',
      },
    });
    expect(
      (notices[0]?.payload as { message: string }).message,
    ).toContain('Please check your catalog.');
    expect(
      (notices[0]?.payload as { message: string }).message,
    ).toContain('Mensaje del administrador de Binflow');

    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Automatización segura con IA'),
    );
    const [created] = await database.db.select().from(schema.requests);
    await expect(
      service.sendRequestMessage(
        plan.requestId!,
        created!.version,
        'Category needs work.',
        'admin:owner',
        'correlation-req-msg-blocked',
        'idempotency-req-msg-blocked',
      ),
    ).rejects.toMatchObject({
      category: 'conflict_error',
      metadata: { code: 'request_message_not_allowed' },
    });

    await database.db
      .update(schema.requests)
      .set({
        terminalResult: { approvalStatus: 'admin_rejected' },
      })
      .where(eq(schema.requests.id, plan.requestId!));

    const requestQueued = await service.sendRequestMessage(
      plan.requestId!,
      created!.version,
      'Category needs work.',
      'admin:owner',
      'correlation-req-msg',
      'idempotency-req-msg',
    );
    expect(requestQueued).toEqual({
      notificationType: 'admin.request_message',
      queued: true,
    });
    const requestNotices = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(
        eq(schema.outboxEvents.eventType, 'client.notification_requested'),
      );
    expect(
      requestNotices.filter(
        (event) =>
          (event.payload as { notificationType?: string }).notificationType ===
          'admin.request_message',
      ),
    ).toHaveLength(1);
  });

  it('does not enqueue client messages when admin rejects', async () => {
    await service.handleTelegramUpdate(
      update('1', '/start pairing-token-abcdefghijklmnopqrstuvwxyz'),
    );
    const plan = await service.handleTelegramUpdate(
      update('2', '/create_blog Categoría nueva para rechazar'),
    );
    const confirmation = plan.actionTokens.find(
      (action) => action.action === 'confirm_plan',
    )!;
    await service.handleTelegramUpdate(
      update('3', `/action ${confirmation.token}`),
    );
    const [request] = await database.db.select().from(schema.requests);
    const [version] = await database.db.select().from(schema.requestVersions);
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'fixture',
        correlationId: 'reject-fixture',
        reason: 'Seed preview evidence for reject',
      },
      async (scoped) => {
        await scoped.insert(schema.artifacts).values({
          bytes: 12,
          id: 'artifact-reject',
          kind: 'preview_bundle',
          mime: 'text/markdown',
          projectId: 'project-webbin',
          requestId: request!.id,
          requestVersionId: version!.id,
          sha256: 'a'.repeat(64),
          storageKey: 'artifact-reject',
          tenantId: 'tenant-webbin',
        });
        await scoped.insert(schema.repoChanges).values({
          artifactHashes: {},
          baseSha: 'base1234567',
          branch: 'preview/reject',
          files: [],
          headSha: 'abcdef1234567',
          id: 'repo-reject',
          projectId: 'project-webbin',
          requestId: request!.id,
          requestVersionId: version!.id,
          tenantId: 'tenant-webbin',
        });
        await scoped.insert(schema.deployments).values({
          commitSha: 'abcdef1234567',
          environment: 'preview',
          id: 'deploy-reject',
          projectId: 'project-webbin',
          providerId: 'preview-reject-1',
          requestVersionId: version!.id,
          state: 'ready',
          tenantId: 'tenant-webbin',
          urls: {},
        });
        await scoped
          .update(schema.requests)
          .set({
            state: 'AWAITING_ADMIN_APPROVAL',
            terminalResult: {
              approvalStatus: 'awaiting_admin',
              categoryKind: 'new',
            },
            version: request!.version,
          })
          .where(eq(schema.requests.id, request!.id));
      },
    );
    const before = await database.db.select().from(schema.outboxEvents);
    await service.rejectAsAdmin(
      request!.id,
      request!.version,
      'admin:owner',
      'correlation-reject',
      'idempotency-reject',
    );
    const after = await database.db.select().from(schema.outboxEvents);
    expect(after).toHaveLength(before.length);
    expect(
      after.filter(
        (event) =>
          event.eventType === 'client.notification_requested' &&
          ((event.payload as { notificationType?: string }).notificationType ===
            'admin.direct_message' ||
            (event.payload as { notificationType?: string })
              .notificationType === 'admin.request_message'),
      ),
    ).toHaveLength(0);
  });
});
