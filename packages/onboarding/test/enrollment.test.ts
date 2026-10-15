import { createHash } from 'node:crypto';

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

describeDatabase('client enrollment lifecycle', () => {
  const database = createDatabase(databaseUrl!);
  const service = new EnrollmentService(database.db, {
    now: () => new Date('2026-08-18T00:00:00.000Z'),
  });

  beforeAll(async () => runMigrations(databaseUrl!));
  beforeEach(async () => {
    await database.db.execute(sql`
      truncate table
        project_budget_policies,
        project_locales,
        project_manifest_versions,
        pairing_tokens,
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

  const completeConfiguration = {
    budgetPolicy: {
      maxEstimatedCostCentsPerDay: 2000,
      maxEstimatedCostCentsPerRequest: 500,
      maxModelCallsPerRequest: 12,
      maxRequestsPerDay: 10,
      maxTokensPerRequest: 120000,
    },
    clientContactEmail: 'client@example.com',
    clientConversationLocale: 'es' as const,
    contentLocales: ['es', 'en'] as const,
    defaultContentLocale: 'es' as const,
    editorialAudience: 'Technical owners',
    editorialVoice: 'Direct and useful',
    productionDomain: 'https://webbin.com.mx',
    prohibitedClaims: ['Unverified outcomes'],
    requiredLocales: ['es', 'en'] as const,
    researchPolicy: 'Use primary sources.',
    slugLocale: 'es' as const,
    timezone: 'America/Mexico_City',
    translationPolicy: 'always_translate' as const,
  };

  const seedActiveCredentials = async (enrollment: {
    projectId: string;
    tenantId: string;
  }) =>
    withPlatformOwnerScope(
      database.db,
      {
        actorId: 'owner-1',
        correlationId: 'manifest-credential-fixture',
        reason: 'Manifest credential fixture',
      },
      async (scoped) => {
        const credentials = [
          {
            id: 'openai-active',
            kind: 'openai',
            ownerScope: 'tenant' as const,
            projectId: null,
            tenantId: enrollment.tenantId,
          },
          {
            id: 'telegram-admin-active',
            kind: 'telegram-admin',
            ownerScope: 'platform' as const,
            projectId: null,
            tenantId: null,
          },
          {
            id: 'telegram-client-active',
            kind: 'telegram-client',
            ownerScope: 'tenant' as const,
            projectId: null,
            tenantId: enrollment.tenantId,
          },
          {
            id: 'github-active',
            kind: 'github-app',
            ownerScope: 'platform' as const,
            projectId: null,
            tenantId: null,
          },
          {
            id: 'vercel-active',
            kind: 'vercel',
            ownerScope: 'project' as const,
            projectId: enrollment.projectId,
            tenantId: enrollment.tenantId,
          },
        ];
        for (const credential of credentials) {
          const secretId = `${credential.id}-secret`;
          await scoped.insert(schema.secretReferences).values({
            algorithm: 'aes-256-gcm',
            authTag: 'tag',
            ciphertext: 'ciphertext',
            credentialVersion: 1,
            id: secretId,
            keyVersion: 1,
            nonce: 'nonce',
            projectId: credential.projectId,
            provider: credential.kind,
            tenantId: credential.tenantId,
            wrapAuthTag: 'tag',
            wrappedDek: 'dek',
            wrapNonce: 'nonce',
          });
          await scoped.insert(schema.providerCredentials).values({
            alias: credential.kind,
            externalResourceId:
              credential.kind === 'telegram-admin'
                ? 'telegram-admin-id'
                : credential.kind === 'telegram-client'
                  ? 'telegram-client-id'
                  : null,
            id: credential.id,
            kind: credential.kind,
            maskedSuffix: '0000',
            ownerScope: credential.ownerScope,
            projectId: credential.projectId,
            secretReferenceId: secretId,
            status: 'active',
            tenantId: credential.tenantId,
            version: 1,
          });
        }
        await scoped.insert(schema.integrationConnections).values([
          {
            credentialId: 'github-active',
            id: 'github-connection',
            kind: 'github-app',
            projectId: enrollment.projectId,
            status: 'active',
            tenantId: enrollment.tenantId,
            verificationEvidence: {
              defaultBranch: 'main',
              installationId: '153846942',
              repository: 'arrobabeto/webbin',
            },
          },
          {
            credentialId: 'vercel-active',
            id: 'vercel-connection',
            kind: 'vercel',
            projectId: enrollment.projectId,
            status: 'active',
            tenantId: enrollment.tenantId,
            verificationEvidence: {
              productionBranch: 'main',
              projectId: 'prj_webbin',
              repository: 'arrobabeto/webbin',
              teamId: 'team_webbin',
            },
          },
        ]);
      },
    );

  it('adopts a draft scope atomically and replays an identical creation', async () => {
    const input = {
      projectDisplayName: 'Webbin',
      projectKey: 'webbin',
      tenantDisplayName: 'Webbin',
      tenantKey: 'webbin',
    };
    const first = await service.create(
      input,
      context('create-enrollment-0001'),
    );
    const replay = await service.create(
      input,
      context('create-enrollment-0001'),
    );

    expect(replay).toEqual(first);
    expect(
      await database.db.select().from(schema.clientEnrollments),
    ).toHaveLength(1);
    const events = await database.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventType, 'enrollment.created'));
    expect(events).toHaveLength(1);
  });

  it('rejects stale updates and writes immutable validation evidence', async () => {
    const created = await service.create(
      {
        projectDisplayName: 'Webbin',
        projectKey: 'webbin',
        tenantDisplayName: 'Webbin',
        tenantKey: 'webbin',
      },
      context('create-enrollment-0002'),
    );
    const updated = await service.update(
      created.id,
      { configuration: {}, currentStep: 2 },
      1,
      context('update-enrollment-0002'),
    );
    await expect(
      service.update(
        created.id,
        { configuration: {}, currentStep: 3 },
        1,
        context('update-enrollment-0003'),
      ),
    ).rejects.toMatchObject({ category: 'conflict_error' });

    const result = await service.validate(
      updated.id,
      updated.version,
      context('validate-enrollment-02'),
    );
    expect(result.enrollment.state).toBe('validation_failed');
    expect(result.attempts.map((attempt) => attempt.checkName)).toContain(
      'configuration',
    );
    const row = (
      await database.db.select().from(schema.enrollmentValidationAttempts)
    )[0]!;
    await expect(
      database.db
        .update(schema.enrollmentValidationAttempts)
        .set({ result: 'success' })
        .where(eq(schema.enrollmentValidationAttempts.id, row.id)),
    ).rejects.toThrow();
  });

  it('stores only the pairing-token hash and returns plaintext once', async () => {
    const created = await service.create(
      {
        projectDisplayName: 'Webbin',
        projectKey: 'webbin',
        tenantDisplayName: 'Webbin',
        tenantKey: 'webbin',
      },
      context('create-enrollment-0003'),
    );
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'owner-1',
        correlationId: 'pairing-fixture',
        reason: 'Pairing test fixture',
      },
      async (scoped) => {
        await scoped
          .update(schema.clientEnrollments)
          .set({ state: 'ready_for_pairing' })
          .where(eq(schema.clientEnrollments.id, created.id));
        await scoped.insert(schema.secretReferences).values({
          algorithm: 'aes-256-gcm',
          authTag: 'tag',
          ciphertext: 'ciphertext',
          credentialVersion: 1,
          id: 'telegram-secret',
          keyVersion: 1,
          nonce: 'nonce',
          provider: 'telegram-client',
          tenantId: created.tenantId,
          wrapAuthTag: 'tag',
          wrappedDek: 'dek',
          wrapNonce: 'nonce',
        });
        await scoped.insert(schema.providerCredentials).values({
          alias: 'Client bot',
          id: 'telegram-credential',
          kind: 'telegram-client',
          maskedSuffix: '0000',
          ownerScope: 'tenant',
          secretReferenceId: 'telegram-secret',
          status: 'active',
          tenantId: created.tenantId,
          verificationEvidence: { username: 'BinflowClientFixture_bot' },
          version: 1,
        });
      },
    );

    const result = await service.createPairingLink(
      created.id,
      1,
      context('pairing-enrollment-003'),
    );
    const token = new URL(result.pairingUrl).searchParams.get('start')!;
    const stored = (await database.db.select().from(schema.pairingTokens))[0]!;
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify(stored)).not.toContain(token);
    const receipt = (
      await database.db
        .select()
        .from(schema.idempotencyRecords)
        .where(
          eq(
            schema.idempotencyRecords.idempotencyKey,
            'pairing-enrollment-003',
          ),
        )
    )[0]!;
    expect(JSON.stringify(receipt.responseBody)).not.toContain(token);
    expect(result.enrollment.state).toBe('pairing_pending');
    await expect(
      service.createPairingLink(
        created.id,
        1,
        context('pairing-enrollment-003'),
      ),
    ).rejects.toMatchObject({
      category: 'conflict_error',
      metadata: { code: 'pairing_link_already_delivered' },
    });
  });

  it('rejects child evidence whose enrollment scope does not match', async () => {
    const first = await service.create(
      {
        projectDisplayName: 'One',
        projectKey: 'one',
        tenantDisplayName: 'One',
        tenantKey: 'one',
      },
      context('create-enrollment-0004'),
    );
    const second = await service.create(
      {
        projectDisplayName: 'Two',
        projectKey: 'two',
        tenantDisplayName: 'Two',
        tenantKey: 'two',
      },
      context('create-enrollment-0005'),
    );
    await expect(
      database.db.insert(schema.enrollmentValidationAttempts).values({
        checkName: 'configuration',
        checkVersion: 1,
        dependencyFingerprint: 'fingerprint',
        enrollmentId: first.id,
        evidence: {},
        id: 'cross-scope-attempt',
        projectId: second.projectId,
        result: 'success',
        tenantId: second.tenantId,
      }),
    ).rejects.toThrow();
  });

  const seedWordpressCredentials = async (enrollment: {
    projectId: string;
    tenantId: string;
  }) =>
    withPlatformOwnerScope(
      database.db,
      {
        actorId: 'owner-1',
        correlationId: 'wordpress-credential-fixture',
        reason: 'WordPress credential fixture',
      },
      async (scoped) => {
        const credentials = [
          { id: 'wp-openai', kind: 'openai', ownerScope: 'tenant' as const, projectId: null, tenantId: enrollment.tenantId },
          { id: 'wp-telegram-admin', kind: 'telegram-admin', ownerScope: 'platform' as const, projectId: null, tenantId: null },
          { id: 'wp-telegram-client', kind: 'telegram-client', ownerScope: 'tenant' as const, projectId: null, tenantId: enrollment.tenantId },
          { id: 'wp-api', kind: 'wordpress-api', ownerScope: 'project' as const, projectId: enrollment.projectId, tenantId: enrollment.tenantId },
        ];
        for (const credential of credentials) {
          const secretId = `${credential.id}-secret`;
          await scoped.insert(schema.secretReferences).values({
            algorithm: 'aes-256-gcm',
            authTag: 'tag',
            ciphertext: 'ciphertext',
            credentialVersion: 1,
            id: secretId,
            keyVersion: 1,
            nonce: 'nonce',
            projectId: credential.projectId,
            provider: credential.kind,
            tenantId: credential.tenantId,
            wrapAuthTag: 'tag',
            wrappedDek: 'dek',
            wrapNonce: 'nonce',
          });
          await scoped.insert(schema.providerCredentials).values({
            alias: credential.kind,
            id: credential.id,
            kind: credential.kind,
            maskedSuffix: '0000',
            ownerScope: credential.ownerScope,
            projectId: credential.projectId,
            secretReferenceId: secretId,
            status: 'active',
            tenantId: credential.tenantId,
            verifiedAt: new Date('2026-10-13T00:00:00.000Z'),
            version: 1,
          });
        }
        await scoped.insert(schema.integrationConnections).values({
          credentialId: 'wp-api',
          id: 'wp-connection',
          kind: 'wordpress-api',
          projectId: enrollment.projectId,
          status: 'active',
          tenantId: enrollment.tenantId,
          verificationEvidence: {
            authenticated: true,
            externalResourceId: 'blog.example.com',
            readProbe: {
              categoryCount: 4,
              latestPostTitles: ['Hola mundo'],
              postCount: 12,
            },
            restBase: 'https://blog.example.com/wp-json/',
            riskWarning: 'administrator_role',
            role: 'administrator',
            siteOrigin: 'https://blog.example.com',
            userId: 1,
            username: 'binflow',
          },
        });
      },
    );

  const wordpressConfiguration = {
    ...completeConfiguration,
    clientConversationLocale: 'es' as const,
    contentLocales: ['es'] as const,
    defaultContentLocale: 'es' as const,
    enabledCapabilities: [],
    productionDomain: 'https://blog.example.com',
    requiredLocales: ['es'] as const,
    slugLocale: 'es' as const,
    translationPolicy: 'none' as const,
  };

  it('validates wordpress_rest without GitHub or Vercel and exposes the read probe', async () => {
    const created = await service.create(
      {
        projectDisplayName: 'Blog',
        projectKey: 'blog',
        projectProfile: 'wordpress_rest',
        tenantDisplayName: 'Blog',
        tenantKey: 'blog',
      },
      context('create-wordpress-enrollment'),
    );
    await seedWordpressCredentials(created);
    const configured = await service.update(
      created.id,
      { configuration: wordpressConfiguration, currentStep: 8 },
      created.version,
      context('configure-wordpress-enrollment'),
    );
    const result = await service.validate(
      configured.id,
      configured.version,
      context('validate-wordpress-enrollment'),
    );

    expect(result.enrollment.state).toBe('ready_for_pairing');
    const names = result.attempts.map((attempt) => attempt.checkName);
    expect(names).not.toContain('github_app_binding');
    expect(names).not.toContain('vercel_binding');
    expect(result.attempts).toContainEqual(
      expect.objectContaining({
        checkName: 'wordpress_read_probe',
        evidence: {
          categoryCount: 4,
          latestPostTitles: ['Hola mundo'],
          postCount: 12,
        },
        result: 'success',
      }),
    );
    expect(result.attempts).toContainEqual(
      expect.objectContaining({
        checkName: 'wordpress_api_credential',
        evidence: expect.objectContaining({
          riskWarning: 'administrator_role',
        }) as unknown,
        result: 'success',
      }),
    );
    for (const checkName of [
      'production_domain_matches_site_url',
      'project_manifest',
      'capability_catalog',
    ])
      expect(result.attempts).toContainEqual(
        expect.objectContaining({ checkName, result: 'success' }),
      );

    const manifest = await service.getManifest(
      created.id,
      'owner-1',
      'read-wordpress-manifest',
    );
    expect(manifest.globalProfile.version).toBe('wordpress_rest@1');
    expect(manifest.manifest).toMatchObject({
      content: { source: 'wordpress' },
      enabledCapabilities: [],
      profile: 'wordpress_rest',
      wordpress: {
        productionOrigin: 'https://blog.example.com',
        role: 'administrator',
        siteOrigin: 'https://blog.example.com',
      },
    });
    expect(manifest.manifest).not.toHaveProperty('repository');
  });

  it('fails wordpress_rest validation when productionDomain is another host', async () => {
    const created = await service.create(
      {
        projectDisplayName: 'Blog',
        projectKey: 'blog',
        projectProfile: 'wordpress_rest',
        tenantDisplayName: 'Blog',
        tenantKey: 'blog',
      },
      context('create-wordpress-mismatch'),
    );
    await seedWordpressCredentials(created);
    const configured = await service.update(
      created.id,
      {
        configuration: {
          ...wordpressConfiguration,
          productionDomain: 'https://shop.example.net',
        },
        currentStep: 8,
      },
      created.version,
      context('configure-wordpress-mismatch'),
    );
    const result = await service.validate(
      configured.id,
      configured.version,
      context('validate-wordpress-mismatch'),
    );

    expect(result.enrollment.state).toBe('validation_failed');
    expect(result.attempts).toContainEqual(
      expect.objectContaining({
        checkName: 'production_domain_matches_site_url',
        errorCode: 'production_domain_mismatch',
        result: 'failed',
      }),
    );
    expect(
      await database.db.select().from(schema.projectManifestVersions),
    ).toHaveLength(0);
  });

  it('materializes, reuses and supersedes immutable manifest snapshots', async () => {
    const created = await service.create(
      {
        projectDisplayName: 'Webbin',
        projectKey: 'webbin',
        tenantDisplayName: 'Webbin',
        tenantKey: 'webbin',
      },
      context('create-manifest-enrollment'),
    );
    await seedActiveCredentials(created);
    const configured = await service.update(
      created.id,
      { configuration: completeConfiguration, currentStep: 8 },
      created.version,
      context('configure-manifest-enrollment'),
    );
    const first = await service.validate(
      configured.id,
      configured.version,
      context('validate-manifest-first'),
    );

    expect(first.enrollment.state).toBe('ready_for_pairing');
    expect(first.attempts).toContainEqual(
      expect.objectContaining({
        checkName: 'project_manifest',
        result: 'success',
      }),
    );
    expect(first.attempts).toContainEqual(
      expect.objectContaining({
        checkName: 'capability_catalog',
        result: 'success',
      }),
    );
    const firstManifest = await service.getManifest(
      created.id,
      'owner-1',
      'read-manifest-first',
    );
    expect(firstManifest.manifest).toMatchObject({
      contentLocales: ['es', 'en'],
      status: 'validated',
      version: 1,
    });
    expect(firstManifest.manifest?.enabledCapabilities).toEqual(
      expect.arrayContaining([
        {
          access: 'client_publish',
          capabilityId: 'create_blog_draft',
          capabilityVersion: 1,
        },
        {
          access: 'client_publish',
          capabilityId: 'create_project_astro',
          capabilityVersion: 1,
        },
      ]),
    );

    const replayed = await service.validate(
      configured.id,
      first.enrollment.version,
      context('validate-manifest-unchanged'),
    );
    expect(replayed.enrollment.state).toBe('ready_for_pairing');
    expect(
      await database.db.select().from(schema.projectManifestVersions),
    ).toHaveLength(1);

    const reconfigured = await service.update(
      configured.id,
      {
        configuration: {
          ...completeConfiguration,
          budgetPolicy: {
            ...completeConfiguration.budgetPolicy,
            maxRequestsPerDay: 11,
          },
        },
        currentStep: 8,
      },
      replayed.enrollment.version,
      context('configure-manifest-change'),
    );
    await service.validate(
      configured.id,
      reconfigured.version,
      context('validate-manifest-change'),
    );
    const versions = await database.db
      .select()
      .from(schema.projectManifestVersions)
      .orderBy(schema.projectManifestVersions.version);
    expect(
      versions.map(({ status, version }) => ({ status, version })),
    ).toEqual([
      { status: 'superseded', version: 1 },
      { status: 'validated', version: 2 },
    ]);
    expect(await database.db.select().from(schema.projectLocales)).toHaveLength(
      2,
    );
    expect(
      await database.db.select().from(schema.projectBudgetPolicies),
    ).toHaveLength(2);
    expect(
      await database.db.select().from(schema.projectCapabilityBindings),
    ).toHaveLength(
      (firstManifest.manifest?.enabledCapabilities.length ?? 0) * 2,
    );
    await expect(
      database.db
        .update(schema.projectLocales)
        .set({ slugLocale: 'en' })
        .where(eq(schema.projectLocales.manifestVersionId, versions[1]!.id)),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(schema.projectCapabilityBindings)
        .set({ access: 'admin_only' })
        .where(
          eq(
            schema.projectCapabilityBindings.manifestVersionId,
            versions[1]!.id,
          ),
        ),
    ).rejects.toThrow();
  });

  it('allows active profile edits and rematerializes production origin', async () => {
    const created = await service.create(
      {
        projectDisplayName: 'Webbin',
        projectKey: 'webbin',
        tenantDisplayName: 'Webbin',
        tenantKey: 'webbin',
      },
      context('create-active-profile-edit'),
    );
    await seedActiveCredentials(created);
    const configured = await service.update(
      created.id,
      {
        configuration: {
          ...completeConfiguration,
          productionDomain: 'https://webbin.mx',
        },
        currentStep: 8,
      },
      created.version,
      context('configure-active-profile-edit'),
    );
    const validated = await service.validate(
      configured.id,
      configured.version,
      context('validate-active-profile-edit'),
    );
    expect(validated.enrollment.state).toBe('ready_for_pairing');
    await withPlatformOwnerScope(
      database.db,
      {
        actorId: 'owner-1',
        correlationId: 'activate-profile-edit',
        reason: 'Activate enrollment for profile edit test',
      },
      async (scoped) => {
        await scoped
          .update(schema.clientEnrollments)
          .set({ state: 'active' })
          .where(eq(schema.clientEnrollments.id, created.id));
        await scoped
          .update(schema.projectManifestVersions)
          .set({ status: 'active' })
          .where(
            eq(schema.projectManifestVersions.projectId, created.projectId),
          );
      },
    );
    const [activeRow] = await database.db
      .select({ version: schema.clientEnrollments.version })
      .from(schema.clientEnrollments)
      .where(eq(schema.clientEnrollments.id, created.id));
    const patched = await service.update(
      created.id,
      {
        configuration: {
          ...completeConfiguration,
          productionDomain: 'https://webbin.com.mx',
        },
        currentStep: 8,
      },
      activeRow!.version,
      context('patch-active-production-domain'),
    );
    expect(patched.state).toBe('active');
    expect(patched.configuration.productionDomain).toBe(
      'https://webbin.com.mx',
    );
    const manifest = await service.getManifest(
      created.id,
      'owner-1',
      'read-active-profile-manifest',
    );
    expect(manifest.manifest).toMatchObject({
      status: 'active',
      deployment: { productionOrigin: 'https://webbin.com.mx' },
    });
  });
});
