import { createHash, randomBytes } from 'node:crypto';

import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  createEnrollmentInputSchema,
  capabilityCatalogResponseSchema,
  enrollmentConfigurationSchema,
  enrollmentSchema,
  projectManifestResponseSchema,
  projectManifestSchema,
  type CreateEnrollmentInput,
  type CapabilityCatalogResponse,
  type Enrollment,
  type EnrollmentConfiguration,
  type EnrollmentValidationAttempt,
  type ProjectManifest,
  type ProjectManifestResponse,
  type UpdateEnrollmentInput,
} from '@binflow/contracts';
import {
  completeIdempotencyRecord,
  hashCanonicalRequest,
  reserveIdempotencyKey,
  schema,
  withPlatformOwnerScope,
  type Database,
  type JsonValue,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError, type Clock, systemClock } from '@binflow/domain';
import {
  astroRepoGlobalProfile,
  buildProjectManifest,
  type VerifiedManifestBindings,
} from '@binflow/manifests';
import {
  projectCapabilityCatalog,
  webbinCapabilityBinding,
} from '@binflow/policies';

const CONFIGURATION_CHECK = 'configuration';
const CREDENTIAL_CHECKS = [
  'openai_credential',
  'telegram_admin_credential',
  'telegram_client_credential',
  'github_app_binding',
  'vercel_binding',
] as const;
const ACTIVATION_ONLY_CHECKS = [
  'project_manifest',
  'capability_catalog',
  'content_catalog',
  'telegram_test_send',
  'github_reversible_probe',
  'vercel_preview_correlation',
  'client_pairing',
] as const;

type ActorContext = Readonly<{
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
}>;

const asJson = (value: unknown): JsonValue => value as JsonValue;
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const ensureConfigurationComplete = (
  configuration: EnrollmentConfiguration,
): readonly string[] => {
  const required: readonly (keyof EnrollmentConfiguration)[] = [
    'clientContactEmail',
    'budgetPolicy',
    'clientConversationLocale',
    'contentLocales',
    'defaultContentLocale',
    'editorialAudience',
    'editorialVoice',
    'productionDomain',
    'prohibitedClaims',
    'requiredLocales',
    'researchPolicy',
    'slugLocale',
    'timezone',
    'translationPolicy',
  ];
  const missing = required.filter((key) => configuration[key] === undefined);
  const content = new Set(configuration.contentLocales ?? []);
  if (content.size !== (configuration.contentLocales?.length ?? 0)) {
    missing.push('contentLocales');
  }
  if (
    (configuration.requiredLocales ?? []).some((locale) => !content.has(locale))
  ) {
    missing.push('requiredLocales');
  }
  if (
    configuration.slugLocale !== undefined &&
    !content.has(configuration.slugLocale)
  ) {
    missing.push('slugLocale');
  }
  if (configuration.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: configuration.timezone });
    } catch {
      missing.push('timezone');
    }
  }
  return [...new Set(missing)];
};

const toProjectManifest = (
  row: typeof schema.projectManifestVersions.$inferSelect,
): ProjectManifest =>
  projectManifestSchema.parse({
    ...row.document,
    status: row.status,
  });

const toEnrollment = (row: {
  enrollment: typeof schema.clientEnrollments.$inferSelect;
  projectKey: string;
  tenantKey: string;
}): Enrollment =>
  enrollmentSchema.parse({
    ...row.enrollment,
    createdAt: row.enrollment.createdAt.toISOString(),
    lastValidatedAt: row.enrollment.lastValidatedAt?.toISOString() ?? null,
    projectKey: row.projectKey,
    tenantKey: row.tenantKey,
    updatedAt: row.enrollment.updatedAt.toISOString(),
  });

const selectEnrollment = async (
  database: ScopedDatabase,
  enrollmentId: string,
): Promise<Enrollment> => {
  const rows = await database
    .select({
      enrollment: schema.clientEnrollments,
      projectKey: schema.projects.key,
      tenantKey: schema.tenants.key,
    })
    .from(schema.clientEnrollments)
    .innerJoin(
      schema.projects,
      eq(schema.projects.id, schema.clientEnrollments.projectId),
    )
    .innerJoin(
      schema.tenants,
      eq(schema.tenants.id, schema.clientEnrollments.tenantId),
    )
    .where(eq(schema.clientEnrollments.id, enrollmentId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new DomainError('validation_error', 'Enrollment was not found.', {
      code: 'enrollment_not_found',
    });
  }
  return toEnrollment(row);
};

const recordAuditAndOutbox = async (
  database: ScopedDatabase,
  input: Readonly<{
    action: string;
    actorId: string;
    correlationId: string;
    enrollmentId: string;
    eventType: string;
    projectId: string;
    tenantId: string;
    version: number;
  }>,
): Promise<void> => {
  await database.insert(schema.auditEvents).values({
    action: input.action,
    actorId: input.actorId,
    actorType: 'platform_owner',
    correlationId: input.correlationId,
    id: uuidv7(),
    metadata: { version: input.version },
    objectId: input.enrollmentId,
    objectType: 'client_enrollment',
    projectId: input.projectId,
    tenantId: input.tenantId,
  });
  await database.insert(schema.outboxEvents).values({
    aggregateId: input.enrollmentId,
    aggregateType: 'client_enrollment',
    eventType: input.eventType,
    eventVersion: 1,
    id: uuidv7(),
    jobKey: `${input.eventType}:${input.enrollmentId}:${String(input.version)}`,
    payload: { version: input.version },
    projectId: input.projectId,
    tenantId: input.tenantId,
  });
};

const withIdempotency = async <T extends JsonValue>(
  database: ScopedDatabase,
  input: ActorContext &
    Readonly<{
      method: string;
      request: JsonValue;
      route: string;
    }>,
  execute: () => Promise<T>,
): Promise<T> => {
  const reserved = await reserveIdempotencyKey(database, {
    actorId: input.actorId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    idempotencyKey: input.idempotencyKey,
    method: input.method,
    requestHash: hashCanonicalRequest(input.request),
    route: input.route,
  });
  if (reserved.kind === 'replay') {
    if (reserved.status !== 'completed') {
      throw new DomainError(
        'conflict_error',
        'The request is still processing.',
        {
          code: 'idempotency_in_progress',
        },
      );
    }
    return reserved.responseBody as T;
  }
  const result = await execute();
  await completeIdempotencyRecord(database, {
    id: reserved.id,
    responseBody: result,
    responseStatus: 200,
    status: 'completed',
  });
  return result;
};

export class EnrollmentService {
  public constructor(
    private readonly database: Database,
    private readonly clock: Clock = systemClock,
  ) {}

  public async list(
    actorId: string,
    correlationId: string,
  ): Promise<Enrollment[]> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'List client enrollments' },
      async (database) => {
        const rows = await database
          .select({
            enrollment: schema.clientEnrollments,
            projectKey: schema.projects.key,
            tenantKey: schema.tenants.key,
          })
          .from(schema.clientEnrollments)
          .innerJoin(
            schema.projects,
            eq(schema.projects.id, schema.clientEnrollments.projectId),
          )
          .innerJoin(
            schema.tenants,
            eq(schema.tenants.id, schema.clientEnrollments.tenantId),
          )
          .orderBy(desc(schema.clientEnrollments.updatedAt));
        return rows.map(toEnrollment);
      },
    );
  }

  public async get(
    enrollmentId: string,
    actorId: string,
    correlationId: string,
  ): Promise<Enrollment> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Read client enrollment' },
      (database) => selectEnrollment(database, enrollmentId),
    );
  }

  public async getManifest(
    enrollmentId: string,
    actorId: string,
    correlationId: string,
  ): Promise<ProjectManifestResponse> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Read project manifest' },
      async (database) => {
        const enrollment = await selectEnrollment(database, enrollmentId);
        const [row] = await database
          .select()
          .from(schema.projectManifestVersions)
          .where(
            and(
              eq(
                schema.projectManifestVersions.projectId,
                enrollment.projectId,
              ),
              eq(schema.projectManifestVersions.tenantId, enrollment.tenantId),
            ),
          )
          .orderBy(desc(schema.projectManifestVersions.version))
          .limit(1);
        return projectManifestResponseSchema.parse({
          globalProfile: astroRepoGlobalProfile,
          manifest: row === undefined ? null : toProjectManifest(row),
        });
      },
    );
  }

  public async getCapabilities(
    projectId: string,
    actorId: string,
    correlationId: string,
  ): Promise<CapabilityCatalogResponse> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'Read project capability catalog' },
      async (database) => {
        const [row] = await database
          .select()
          .from(schema.projectManifestVersions)
          .where(eq(schema.projectManifestVersions.projectId, projectId))
          .orderBy(desc(schema.projectManifestVersions.version))
          .limit(1);
        if (row === undefined)
          return capabilityCatalogResponseSchema.parse({
            items: [],
            manifestVersion: null,
            projectId,
          });
        const manifest = toProjectManifest(row);
        return capabilityCatalogResponseSchema.parse({
          items: projectCapabilityCatalog(manifest.enabledCapabilities),
          manifestVersion: manifest.version,
          projectId,
        });
      },
    );
  }

  public async create(
    rawInput: CreateEnrollmentInput,
    context: ActorContext,
  ): Promise<Enrollment> {
    const input = createEnrollmentInputSchema.parse(rawInput);
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Create client enrollment',
      },
      (database) =>
        withIdempotency(
          database,
          {
            ...context,
            method: 'POST',
            request: asJson(input),
            route: '/api/v1/admin/enrollments',
          },
          async () => {
            await database.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`enrollment:${input.tenantKey}:${input.projectKey}`}))`,
            );
            let tenant = await database.query.tenants.findFirst({
              where: eq(schema.tenants.key, input.tenantKey),
            });
            if (tenant === undefined) {
              [tenant] = await database
                .insert(schema.tenants)
                .values({
                  displayName: input.tenantDisplayName,
                  id: uuidv7(),
                  key: input.tenantKey,
                })
                .returning();
            } else if (tenant.status !== 'draft') {
              throw new DomainError(
                'conflict_error',
                'Tenant key is already active.',
                {
                  code: 'tenant_key_unavailable',
                },
              );
            }
            if (tenant === undefined) throw new Error('Tenant insert failed.');
            const tenantProjects = await database.query.projects.findMany({
              where: eq(schema.projects.tenantId, tenant.id),
            });
            if (
              tenantProjects.some(
                (candidate) => candidate.key !== input.projectKey,
              )
            ) {
              throw new DomainError(
                'conflict_error',
                'The first-MVP tenant already owns another project.',
                { code: 'tenant_project_limit' },
              );
            }
            let project = await database.query.projects.findFirst({
              where: and(
                eq(schema.projects.tenantId, tenant.id),
                eq(schema.projects.key, input.projectKey),
              ),
            });
            if (project === undefined) {
              [project] = await database
                .insert(schema.projects)
                .values({
                  displayName: input.projectDisplayName,
                  id: uuidv7(),
                  key: input.projectKey,
                  profile: 'astro_repo',
                  tenantId: tenant.id,
                })
                .returning();
            } else if (
              project.status !== 'draft' ||
              project.profile !== 'astro_repo'
            ) {
              throw new DomainError(
                'conflict_error',
                'Project key cannot be adopted.',
                {
                  code: 'project_key_unavailable',
                },
              );
            }
            if (project === undefined)
              throw new Error('Project insert failed.');
            const existing = await database.query.clientEnrollments.findFirst({
              where: eq(schema.clientEnrollments.tenantId, tenant.id),
            });
            if (existing !== undefined) {
              throw new DomainError(
                'conflict_error',
                'Tenant already has an enrollment.',
                {
                  code: 'enrollment_exists',
                },
              );
            }
            const enrollmentId = uuidv7();
            await database.insert(schema.clientEnrollments).values({
              id: enrollmentId,
              projectId: project.id,
              tenantId: tenant.id,
            });
            await recordAuditAndOutbox(database, {
              action: 'enrollment.created',
              actorId: context.actorId,
              correlationId: context.correlationId,
              enrollmentId,
              eventType: 'enrollment.created',
              projectId: project.id,
              tenantId: tenant.id,
              version: 1,
            });
            return asJson(await selectEnrollment(database, enrollmentId));
          },
        ).then((value) => enrollmentSchema.parse(value)),
    );
  }

  public async update(
    enrollmentId: string,
    input: UpdateEnrollmentInput,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<Enrollment> {
    const configuration = enrollmentConfigurationSchema.parse(
      input.configuration,
    );
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Update client enrollment',
      },
      (database) =>
        withIdempotency(
          database,
          {
            ...context,
            method: 'PATCH',
            request: asJson({ expectedVersion, input }),
            route: `/api/v1/admin/enrollments/${enrollmentId}`,
          },
          async () => {
            const now = this.clock.now();
            const updated = await database
              .update(schema.clientEnrollments)
              .set({
                configuration,
                currentStep: input.currentStep,
                state: 'configuring',
                updatedAt: now,
                version: sql`${schema.clientEnrollments.version} + 1`,
              })
              .where(
                and(
                  eq(schema.clientEnrollments.id, enrollmentId),
                  eq(schema.clientEnrollments.version, expectedVersion),
                  inArray(schema.clientEnrollments.state, [
                    'draft',
                    'configuring',
                    'validation_failed',
                    'ready_for_pairing',
                  ]),
                ),
              )
              .returning();
            const row = updated[0];
            if (row === undefined)
              throw new DomainError(
                'conflict_error',
                'Enrollment version or state is stale.',
                { code: 'stale_enrollment' },
              );
            await recordAuditAndOutbox(database, {
              action: 'enrollment.updated',
              actorId: context.actorId,
              correlationId: context.correlationId,
              enrollmentId,
              eventType: 'enrollment.updated',
              projectId: row.projectId,
              tenantId: row.tenantId,
              version: row.version,
            });
            return asJson(await selectEnrollment(database, enrollmentId));
          },
        ).then((value) => enrollmentSchema.parse(value)),
    );
  }

  public async validate(
    enrollmentId: string,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<
    Readonly<{
      attempts: EnrollmentValidationAttempt[];
      enrollment: Enrollment;
    }>
  > {
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Validate client enrollment',
      },
      (database) =>
        withIdempotency(
          database,
          {
            ...context,
            method: 'POST',
            request: asJson({ expectedVersion }),
            route: `/api/v1/admin/enrollments/${enrollmentId}/validate`,
          },
          async () => {
            const current = await selectEnrollment(database, enrollmentId);
            if (current.version !== expectedVersion)
              throw new DomainError(
                'conflict_error',
                'Enrollment version is stale.',
                { code: 'stale_enrollment' },
              );
            if (
              ![
                'draft',
                'configuring',
                'validation_failed',
                'ready_for_pairing',
              ].includes(current.state)
            ) {
              throw new DomainError(
                'conflict_error',
                'Enrollment cannot be validated from its current state.',
                { code: 'invalid_enrollment_transition' },
              );
            }
            const missing = ensureConfigurationComplete(current.configuration);
            const checks: Readonly<{
              checkName: string;
              evidence: Record<string, JsonValue>;
              errorCategory?: string;
              errorCode?: string;
              result: 'success' | 'failed' | 'blocked';
            }>[] = [
              {
                checkName: CONFIGURATION_CHECK,
                evidence:
                  missing.length === 0 ? { complete: true } : { missing },
                ...(missing.length === 0
                  ? {}
                  : {
                      errorCategory: 'validation_error',
                      errorCode: 'configuration_incomplete',
                    }),
                result: missing.length === 0 ? 'success' : 'failed',
              },
            ];
            const credentialChecks = await this.resolveCredentialChecks(
              database,
              current,
            );
            checks.push(...credentialChecks);
            if (
              missing.length === 0 &&
              credentialChecks.every((check) => check.result === 'success')
            ) {
              try {
                const manifest = await this.materializeManifest(
                  database,
                  current,
                  context,
                );
                checks.push({
                  checkName: 'project_manifest',
                  evidence: {
                    fingerprint: manifest.fingerprint,
                    globalProfileVersion: manifest.globalProfileVersion,
                    manifestId: manifest.id,
                    manifestVersion: manifest.version,
                  },
                  result: 'success',
                });
                const catalog = projectCapabilityCatalog(
                  manifest.enabledCapabilities,
                );
                checks.push({
                  checkName: 'capability_catalog',
                  evidence: {
                    capabilityIds: catalog.map(
                      (capability) =>
                        `${capability.id}@${String(capability.version)}`,
                    ),
                    manifestVersion: manifest.version,
                  },
                  result:
                    catalog.length === 1 && catalog[0]?.enabled === true
                      ? 'success'
                      : 'failed',
                  ...(catalog.length === 1 && catalog[0]?.enabled === true
                    ? {}
                    : {
                        errorCategory: 'policy_denied',
                        errorCode: 'capability_catalog_invalid',
                      }),
                });
              } catch (error) {
                if (!(error instanceof DomainError)) throw error;
                const domainError = error;
                checks.push({
                  checkName: 'project_manifest',
                  errorCategory: domainError.category,
                  errorCode:
                    domainError.metadata.code ?? 'project_manifest_failed',
                  evidence: { valid: false },
                  result: 'failed',
                });
                checks.push({
                  checkName: 'capability_catalog',
                  errorCategory: 'policy_denied',
                  errorCode: 'capability_catalog_blocked',
                  evidence: { manifestReady: false },
                  result: 'blocked',
                });
              }
            } else {
              checks.push({
                checkName: 'project_manifest',
                errorCategory: 'validation_error',
                errorCode: 'project_manifest_dependencies_blocked',
                evidence: { dependenciesReady: false },
                result: 'blocked',
              });
              checks.push({
                checkName: 'capability_catalog',
                errorCategory: 'validation_error',
                errorCode: 'capability_catalog_dependencies_blocked',
                evidence: { manifestReady: false },
                result: 'blocked',
              });
            }
            const checkedAt = this.clock.now();
            const dependencyFingerprint = fingerprint({
              configuration: current.configuration,
              checks: credentialChecks,
            });
            await database.insert(schema.enrollmentValidationAttempts).values(
              checks.map((check) => ({
                checkName: check.checkName,
                checkVersion: 1,
                checkedAt,
                dependencyFingerprint,
                enrollmentId,
                evidence: check.evidence,
                ...(check.result === 'success'
                  ? {}
                  : {
                      errorCategory:
                        check.errorCategory ?? 'credential_unavailable',
                      errorCode:
                        check.errorCode ?? `${check.checkName}_missing`,
                    }),
                id: uuidv7(),
                projectId: current.projectId,
                result: check.result,
                tenantId: current.tenantId,
              })),
            );
            const success = checks.every((check) => check.result === 'success');
            const nextVersion = current.version + 1;
            const transitioned = await database
              .update(schema.clientEnrollments)
              .set({
                lastValidatedAt: checkedAt,
                state: success ? 'ready_for_pairing' : 'validation_failed',
                updatedAt: checkedAt,
                version: nextVersion,
              })
              .where(
                and(
                  eq(schema.clientEnrollments.id, enrollmentId),
                  eq(schema.clientEnrollments.version, expectedVersion),
                ),
              )
              .returning({ id: schema.clientEnrollments.id });
            if (transitioned.length !== 1) {
              throw new DomainError(
                'conflict_error',
                'Enrollment version changed during validation.',
                { code: 'stale_enrollment' },
              );
            }
            await recordAuditAndOutbox(database, {
              action: 'enrollment.validated',
              actorId: context.actorId,
              correlationId: context.correlationId,
              enrollmentId,
              eventType: 'enrollment.validated',
              projectId: current.projectId,
              tenantId: current.tenantId,
              version: nextVersion,
            });
            return asJson({
              attempts: checks.map((check) => ({
                checkName: check.checkName,
                checkedAt: checkedAt.toISOString(),
                errorCategory:
                  check.result === 'success'
                    ? null
                    : (check.errorCategory ?? 'credential_unavailable'),
                errorCode:
                  check.result === 'success'
                    ? null
                    : (check.errorCode ?? `${check.checkName}_missing`),
                evidence: check.evidence,
                result: check.result,
              })),
              enrollment: await selectEnrollment(database, enrollmentId),
            });
          },
        ),
    ).then(
      (value) =>
        value as unknown as {
          attempts: EnrollmentValidationAttempt[];
          enrollment: Enrollment;
        },
    );
  }

  public async createPairingLink(
    enrollmentId: string,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<
    Readonly<{ enrollment: Enrollment; expiresAt: string; pairingUrl: string }>
  > {
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Create client pairing link',
      },
      async (database) => {
        const request = asJson({ expectedVersion });
        const reserved = await reserveIdempotencyKey(database, {
          actorId: context.actorId,
          expiresAt: new Date(this.clock.now().getTime() + 24 * 60 * 60 * 1000),
          idempotencyKey: context.idempotencyKey,
          method: 'POST',
          requestHash: hashCanonicalRequest(request),
          route: `/api/v1/admin/enrollments/${enrollmentId}/pairing-link`,
        });
        if (reserved.kind === 'replay') {
          throw new DomainError(
            'conflict_error',
            'The one-time pairing link was already delivered.',
            { code: 'pairing_link_already_delivered' },
          );
        }
        const current = await selectEnrollment(database, enrollmentId);
        if (
          current.version !== expectedVersion ||
          current.state !== 'ready_for_pairing'
        ) {
          throw new DomainError(
            'conflict_error',
            'Enrollment is not ready for pairing.',
            { code: 'pairing_not_ready' },
          );
        }
        const bot = await database
          .select({
            credentialId: schema.providerCredentials.id,
            evidence: schema.providerCredentials.verificationEvidence,
          })
          .from(schema.providerCredentials)
          .where(
            and(
              eq(schema.providerCredentials.kind, 'telegram-client'),
              eq(schema.providerCredentials.ownerScope, 'tenant'),
              eq(schema.providerCredentials.tenantId, current.tenantId),
              eq(schema.providerCredentials.status, 'active'),
            ),
          )
          .limit(1);
        const activeBot = bot[0];
        const username = (
          activeBot?.evidence as { username?: unknown } | undefined
        )?.username;
        if (
          activeBot === undefined ||
          typeof username !== 'string' ||
          username.length === 0
        )
          throw new DomainError(
            'credential_unavailable',
            'Telegram client bot is unavailable.',
          );
        const existingUser = await database
          .select({ id: schema.clientUsers.id })
          .from(schema.clientUsers)
          .where(eq(schema.clientUsers.enrollmentId, enrollmentId))
          .limit(1);
        const userId = existingUser[0]?.id ?? uuidv7();
        if (existingUser.length === 0) {
          await database.insert(schema.clientUsers).values({
            ...(current.configuration.clientContactEmail === undefined
              ? {}
              : { contactEmail: current.configuration.clientContactEmail }),
            displayName: `${current.tenantKey} client`,
            enrollmentId,
            id: userId,
            projectId: current.projectId,
            tenantId: current.tenantId,
          });
          await database.insert(schema.memberships).values({
            id: uuidv7(),
            projectId: current.projectId,
            role: 'client',
            status: 'pending_pairing',
            tenantId: current.tenantId,
            userId,
          });
        }
        const token = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const now = this.clock.now();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        await database
          .update(schema.pairingTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(schema.pairingTokens.enrollmentId, enrollmentId),
              sql`${schema.pairingTokens.consumedAt} IS NULL`,
              sql`${schema.pairingTokens.revokedAt} IS NULL`,
            ),
          );
        await database.insert(schema.pairingTokens).values({
          createdBy: context.actorId,
          enrollmentId,
          expiresAt,
          id: uuidv7(),
          projectId: current.projectId,
          tenantId: current.tenantId,
          tokenHash,
          userId,
          botCredentialId: activeBot.credentialId,
        });
        const nextVersion = current.version + 1;
        const transitioned = await database
          .update(schema.clientEnrollments)
          .set({
            state: 'pairing_pending',
            updatedAt: now,
            version: nextVersion,
          })
          .where(
            and(
              eq(schema.clientEnrollments.id, enrollmentId),
              eq(schema.clientEnrollments.version, expectedVersion),
            ),
          )
          .returning({ id: schema.clientEnrollments.id });
        if (transitioned.length !== 1) {
          throw new DomainError(
            'conflict_error',
            'Enrollment version changed while creating the pairing link.',
            { code: 'stale_enrollment' },
          );
        }
        await recordAuditAndOutbox(database, {
          action: 'enrollment.pairing_link_created',
          actorId: context.actorId,
          correlationId: context.correlationId,
          enrollmentId,
          eventType: 'enrollment.pairing_link_created',
          projectId: current.projectId,
          tenantId: current.tenantId,
          version: nextVersion,
        });
        const enrollment = await selectEnrollment(database, enrollmentId);
        await completeIdempotencyRecord(database, {
          id: reserved.id,
          responseBody: {
            delivered: true,
            enrollmentId,
            expiresAt: expiresAt.toISOString(),
          },
          responseStatus: 200,
          status: 'completed',
        });
        return {
          enrollment,
          expiresAt: expiresAt.toISOString(),
          pairingUrl: `https://t.me/${username}?start=${token}`,
        };
      },
    );
  }

  public async evaluateActivation(
    enrollmentId: string,
    expectedVersion: number,
    context: ActorContext,
  ): Promise<Readonly<{ blockers: readonly string[]; ready: boolean }>> {
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Evaluate client activation',
      },
      (database) =>
        withIdempotency(
          database,
          {
            ...context,
            method: 'POST',
            request: asJson({ expectedVersion }),
            route: `/api/v1/admin/enrollments/${enrollmentId}/activate`,
          },
          async () => {
            const enrollment = await selectEnrollment(database, enrollmentId);
            if (enrollment.version !== expectedVersion) {
              throw new DomainError(
                'conflict_error',
                'Enrollment version is stale.',
                {
                  code: 'stale_enrollment',
                },
              );
            }
            const attempts = await database
              .select({
                checkName: schema.enrollmentValidationAttempts.checkName,
                checkedAt: schema.enrollmentValidationAttempts.checkedAt,
                result: schema.enrollmentValidationAttempts.result,
              })
              .from(schema.enrollmentValidationAttempts)
              .where(
                eq(
                  schema.enrollmentValidationAttempts.enrollmentId,
                  enrollmentId,
                ),
              )
              .orderBy(desc(schema.enrollmentValidationAttempts.checkedAt));
            const blockers: string[] = ACTIVATION_ONLY_CHECKS.filter(
              (name) =>
                attempts.find(
                  (attempt) =>
                    attempt.checkName === name &&
                    enrollment.lastValidatedAt !== null &&
                    attempt.checkedAt.getTime() >=
                      new Date(enrollment.lastValidatedAt).getTime(),
                )?.result !== 'success',
            );
            if (enrollment.state !== 'pairing_pending') {
              blockers.unshift('enrollment_state');
            }
            return asJson({ blockers, ready: blockers.length === 0 });
          },
        ),
    ).then(
      (value) =>
        value as unknown as { blockers: readonly string[]; ready: boolean },
    );
  }

  private async materializeManifest(
    database: ScopedDatabase,
    enrollment: Enrollment,
    context: ActorContext,
  ): Promise<ProjectManifest> {
    await database.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`project-manifest:${enrollment.projectId}`}))`,
    );
    const bindings = await this.resolveManifestBindings(database, enrollment);
    const [latest] = await database
      .select()
      .from(schema.projectManifestVersions)
      .where(
        and(
          eq(schema.projectManifestVersions.projectId, enrollment.projectId),
          eq(schema.projectManifestVersions.tenantId, enrollment.tenantId),
        ),
      )
      .orderBy(desc(schema.projectManifestVersions.version))
      .limit(1);
    const nextVersion = (latest?.version ?? 0) + 1;
    const now = this.clock.now();
    const candidate = buildProjectManifest({
      configuration: enrollment.configuration,
      id: uuidv7(),
      projectId: enrollment.projectId,
      projectKey: enrollment.projectKey,
      tenantKey: enrollment.tenantKey,
      validatedAt: now,
      verifiedBindings: bindings,
      version: nextVersion,
    });
    if (
      latest?.dependencyFingerprint === candidate.fingerprint &&
      (latest.status === 'validated' || latest.status === 'active')
    )
      return toProjectManifest(latest);

    if (
      latest !== undefined &&
      (latest.status === 'draft' || latest.status === 'validated')
    )
      await database
        .update(schema.projectManifestVersions)
        .set({ status: 'superseded', supersededAt: now })
        .where(eq(schema.projectManifestVersions.id, latest.id));

    await database.insert(schema.projectManifestVersions).values({
      createdBy: context.actorId,
      dependencyFingerprint: candidate.fingerprint,
      document: candidate,
      globalProfileVersion: candidate.globalProfileVersion,
      id: candidate.id,
      profile: candidate.profile,
      projectId: enrollment.projectId,
      status: 'validated',
      tenantId: enrollment.tenantId,
      validatedAt: now,
      version: candidate.version,
    });
    await database.insert(schema.projectLocales).values({
      contentLocales: candidate.contentLocales,
      conversationLocale: candidate.conversationLocale,
      defaultContentLocale: candidate.defaultContentLocale,
      id: uuidv7(),
      manifestVersionId: candidate.id,
      projectId: enrollment.projectId,
      requiredContentLocales: candidate.requiredContentLocales,
      slugLocale: candidate.slugLocale,
      tenantId: enrollment.tenantId,
      translationPolicy: candidate.translationPolicy,
    });
    await database.insert(schema.projectBudgetPolicies).values({
      id: uuidv7(),
      manifestVersionId: candidate.id,
      maxEstimatedCostCentsPerDay:
        candidate.budgetPolicy.maxEstimatedCostCentsPerDay,
      maxEstimatedCostCentsPerRequest:
        candidate.budgetPolicy.maxEstimatedCostCentsPerRequest,
      maxModelCallsPerRequest: candidate.budgetPolicy.maxModelCallsPerRequest,
      maxRequestsPerDay: candidate.budgetPolicy.maxRequestsPerDay,
      maxTokensPerRequest: candidate.budgetPolicy.maxTokensPerRequest,
      projectId: enrollment.projectId,
      tenantId: enrollment.tenantId,
    });
    await database.insert(schema.projectCapabilityBindings).values({
      access: webbinCapabilityBinding.access,
      capabilityId: webbinCapabilityBinding.capabilityId,
      capabilityVersion: webbinCapabilityBinding.capabilityVersion,
      createdBy: context.actorId,
      id: uuidv7(),
      manifestVersionId: candidate.id,
      projectId: enrollment.projectId,
      tenantId: enrollment.tenantId,
    });
    await database.insert(schema.auditEvents).values({
      action: 'project_manifest.validated',
      actorId: context.actorId,
      actorType: 'platform_owner',
      correlationId: context.correlationId,
      id: uuidv7(),
      metadata: {
        fingerprint: candidate.fingerprint,
        globalProfileVersion: candidate.globalProfileVersion,
        version: candidate.version,
      },
      objectId: candidate.id,
      objectType: 'project_manifest',
      projectId: enrollment.projectId,
      tenantId: enrollment.tenantId,
    });
    await database.insert(schema.outboxEvents).values({
      aggregateId: candidate.id,
      aggregateType: 'project_manifest',
      eventType: 'project_manifest.validated',
      eventVersion: 1,
      id: uuidv7(),
      jobKey: `project_manifest.validated:${candidate.id}`,
      payload: {
        fingerprint: candidate.fingerprint,
        version: candidate.version,
      },
      projectId: enrollment.projectId,
      tenantId: enrollment.tenantId,
    });
    return candidate;
  }

  private async resolveManifestBindings(
    database: ScopedDatabase,
    enrollment: Enrollment,
  ): Promise<VerifiedManifestBindings> {
    const rows = await database
      .select({
        evidence: schema.integrationConnections.verificationEvidence,
        kind: schema.integrationConnections.kind,
      })
      .from(schema.integrationConnections)
      .innerJoin(
        schema.providerCredentials,
        eq(
          schema.providerCredentials.id,
          schema.integrationConnections.credentialId,
        ),
      )
      .where(
        and(
          eq(schema.integrationConnections.projectId, enrollment.projectId),
          eq(schema.integrationConnections.tenantId, enrollment.tenantId),
          eq(schema.integrationConnections.status, 'active'),
          eq(schema.providerCredentials.status, 'active'),
          inArray(schema.integrationConnections.kind, ['github-app', 'vercel']),
        ),
      );
    const evidence = (kind: 'github-app' | 'vercel') => {
      const value = rows.find((row) => row.kind === kind)?.evidence;
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new DomainError(
          'credential_unavailable',
          `${kind} verified binding evidence is unavailable.`,
          { code: `${kind}_binding_evidence_missing` },
        );
      return value as Record<string, unknown>;
    };
    const github = evidence('github-app');
    const vercel = evidence('vercel');
    const requiredString = (
      value: Record<string, unknown>,
      key: string,
      kind: string,
    ): string => {
      const field = value[key];
      if (typeof field !== 'string' || field.length === 0)
        throw new DomainError(
          'credential_unavailable',
          `${kind} verified binding evidence is incomplete.`,
          { code: `${kind}_binding_evidence_missing` },
        );
      return field;
    };
    const teamId = vercel.teamId;
    return {
      github: {
        defaultBranch: requiredString(github, 'defaultBranch', 'github'),
        installationId: requiredString(github, 'installationId', 'github'),
        repository: requiredString(github, 'repository', 'github'),
      },
      vercel: {
        productionBranch: requiredString(vercel, 'productionBranch', 'vercel'),
        projectId: requiredString(vercel, 'projectId', 'vercel'),
        repository: requiredString(vercel, 'repository', 'vercel'),
        ...(typeof teamId === 'string' && teamId.length > 0 ? { teamId } : {}),
      },
    };
  }

  private async resolveCredentialChecks(
    database: ScopedDatabase,
    enrollment: Enrollment,
  ): Promise<
    Readonly<{
      checkName: string;
      evidence: Record<string, JsonValue>;
      result: 'success' | 'failed';
    }>[]
  > {
    const direct = await database
      .select({
        id: schema.providerCredentials.id,
        kind: schema.providerCredentials.kind,
        version: schema.providerCredentials.version,
      })
      .from(schema.providerCredentials)
      .where(
        and(
          eq(schema.providerCredentials.status, 'active'),
          or(
            and(
              eq(schema.providerCredentials.kind, 'openai'),
              eq(schema.providerCredentials.tenantId, enrollment.tenantId),
            ),
            and(
              eq(schema.providerCredentials.kind, 'telegram-admin'),
              eq(schema.providerCredentials.ownerScope, 'platform'),
              isNull(schema.providerCredentials.tenantId),
            ),
            and(
              eq(schema.providerCredentials.kind, 'telegram-client'),
              eq(schema.providerCredentials.ownerScope, 'tenant'),
              eq(schema.providerCredentials.tenantId, enrollment.tenantId),
            ),
          ),
        ),
      );
    const connected = await database
      .select({
        id: schema.providerCredentials.id,
        kind: schema.integrationConnections.kind,
        version: schema.providerCredentials.version,
      })
      .from(schema.integrationConnections)
      .innerJoin(
        schema.providerCredentials,
        eq(
          schema.providerCredentials.id,
          schema.integrationConnections.credentialId,
        ),
      )
      .where(
        and(
          eq(schema.integrationConnections.projectId, enrollment.projectId),
          eq(schema.integrationConnections.tenantId, enrollment.tenantId),
          eq(schema.integrationConnections.status, 'active'),
          eq(schema.providerCredentials.status, 'active'),
          inArray(schema.integrationConnections.kind, ['github-app', 'vercel']),
        ),
      );
    const match = (checkName: (typeof CREDENTIAL_CHECKS)[number]) => {
      if (checkName === 'openai_credential')
        return direct.find((item) => item.kind === 'openai');
      if (checkName === 'telegram_admin_credential')
        return direct.find((item) => item.kind === 'telegram-admin');
      if (checkName === 'telegram_client_credential')
        return direct.find((item) => item.kind === 'telegram-client');
      if (checkName === 'github_app_binding')
        return connected.find((item) => item.kind === 'github-app');
      return connected.find((item) => item.kind === 'vercel');
    };
    return CREDENTIAL_CHECKS.map((checkName) => {
      const credential = match(checkName);
      return {
        checkName,
        evidence:
          credential === undefined
            ? { active: false }
            : {
                active: true,
                credentialId: credential.id,
                version: credential.version,
              },
        result: credential === undefined ? 'failed' : 'success',
      };
    });
  }
}
