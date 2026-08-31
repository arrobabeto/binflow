import { z } from 'zod';

export const supportedLocaleSchema = z.enum(['en', 'es', 'de']);
export const translationPolicySchema = z.enum([
  'always_translate',
  'ask_each_action',
  'none',
]);
export const projectBudgetPolicySchema = z
  .object({
    maxEstimatedCostCentsPerDay: z.number().int().min(1).max(1_000_000),
    maxEstimatedCostCentsPerRequest: z.number().int().min(1).max(100_000),
    maxModelCallsPerRequest: z.number().int().min(1).max(100),
    maxRequestsPerDay: z.number().int().min(1).max(1_000),
    maxTokensPerRequest: z.number().int().min(1_000).max(1_000_000),
  })
  .strict()
  .refine(
    (policy) =>
      policy.maxEstimatedCostCentsPerDay >=
      policy.maxEstimatedCostCentsPerRequest,
    {
      message:
        'Daily estimated cost must be at least the per-request estimated cost.',
      path: ['maxEstimatedCostCentsPerDay'],
    },
  );
export const projectProfileSchema = z.enum([
  'astro_repo',
  'astro_orbitype',
  'nuxt_orbitype',
  'wordpress_rest',
]);

export const integrationKindSchema = z.enum([
  'openai',
  'telegram-admin',
  'telegram-client',
  'github-app',
  'vercel',
  'orbitype-api',
]);

/** Profiles selectable for new enrollments (post-MVP includes astro_orbitype). */
export const selectableEnrollmentProfileSchema = z.enum([
  'astro_repo',
  'astro_orbitype',
]);

export const integrationStatusSchema = z.enum([
  'unverified',
  'active',
  'invalid',
  'superseded',
  'revoked',
]);

export const credentialOwnerScopeSchema = z.enum([
  'platform',
  'tenant',
  'project',
]);

const integrationScopeKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const credentialAliasSchema = z.string().trim().min(1).max(120);
const telegramUsernameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^[A-Za-z0-9_]{5,32}$/));

export const integrationCandidateInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      alias: credentialAliasSchema,
      apiKey: z.string().min(20).max(512),
      kind: z.literal('openai'),
      tenantKey: integrationScopeKeySchema,
    })
    .strict(),
  z
    .object({
      alias: credentialAliasSchema,
      botToken: z.string().min(20).max(256),
      expectedUsername: telegramUsernameSchema,
      kind: z.literal('telegram-admin'),
    })
    .strict(),
  z
    .object({
      alias: credentialAliasSchema,
      botToken: z.string().min(20).max(256),
      expectedUsername: telegramUsernameSchema,
      kind: z.literal('telegram-client'),
      tenantKey: integrationScopeKeySchema,
    })
    .strict(),
  z
    .object({
      alias: credentialAliasSchema,
      appId: z.string().regex(/^\d+$/),
      clientId: z.string().trim().min(1).max(100),
      kind: z.literal('github-app'),
      privateKey: z
        .string()
        .min(100)
        .max(64 * 1024)
        .refine(
          (value) =>
            value.includes('-----BEGIN') && value.includes('PRIVATE KEY-----'),
          { message: 'A PEM private key is required.' },
        ),
      projectKey: integrationScopeKeySchema,
      tenantKey: integrationScopeKeySchema,
      webhookSecret: z.string().min(32).max(512),
      defaultBranch: z.string().trim().min(1).max(200).optional(),
      expectedRepository: z
        .string()
        .regex(/^[^/]+\/[^/]+$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      alias: credentialAliasSchema,
      kind: z.literal('vercel'),
      projectId: z.string().trim().min(1).max(120),
      projectKey: integrationScopeKeySchema,
      teamId: z.string().trim().min(1).max(120).optional(),
      tenantKey: integrationScopeKeySchema,
      token: z.string().min(20).max(512),
      expectedProductionBranch: z.string().trim().min(1).max(200).optional(),
      expectedRepository: z
        .string()
        .regex(/^[^/]+\/[^/]+$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      alias: credentialAliasSchema,
      apiKey: z.string().min(8).max(512),
      baseUrl: z.string().url().max(500),
      kind: z.literal('orbitype-api'),
      projectKey: integrationScopeKeySchema,
      tenantKey: integrationScopeKeySchema,
    })
    .strict(),
]);

export const errorCategorySchema = z.enum([
  'validation_error',
  'authentication_error',
  'authorization_error',
  'policy_denied',
  'conflict_error',
  'budget_exceeded',
  'credential_unavailable',
  'provider_retryable',
  'provider_final',
  'internal_error',
]);

export const apiErrorResponseSchema = z
  .object({
    error: z
      .object({
        category: errorCategorySchema,
        code: z.string().min(1),
        message: z.string().min(1),
        correlationId: z.string().min(1),
        fieldErrors: z
          .record(z.string(), z.array(z.string().min(1)))
          .optional(),
      })
      .strict(),
  })
  .strict();

export const cursorQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const requestListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z
      .union([
        z.literal(10),
        z.literal(30),
        z.literal(50),
        z.literal('10'),
        z.literal('30'),
        z.literal('50'),
      ])
      .optional()
      .transform((value) =>
        value === undefined ? 10 : (Number(value) as 10 | 30 | 50),
      ),
    needsAdminApproval: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (value === true || value === 'true') return true;
        return false;
      }),
    projectId: z.string().min(1).optional(),
  })
  .strict();

export const requestListCursorSchema = z
  .object({
    id: z.string().min(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const encodeRequestListCursor = (
  input: z.infer<typeof requestListCursorSchema>,
): string =>
  encodeURIComponent(JSON.stringify(requestListCursorSchema.parse(input)));

export const decodeRequestListCursor = (
  cursor: string,
): z.infer<typeof requestListCursorSchema> =>
  requestListCursorSchema.parse(JSON.parse(decodeURIComponent(cursor)));

export const requestListPageSizes = [10, 30, 50] as const;

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);

export const resourceVersionSchema = z.number().int().positive();

export const credentialSummarySchema = z
  .object({
    alias: z.string().min(1),
    bindingProjectKey: z.string().nullable(),
    bindingTenantKey: z.string().nullable(),
    createdAt: z.iso.datetime(),
    id: z.string().min(1),
    kind: integrationKindSchema,
    maskedSuffix: z.string().length(4),
    ownerScope: credentialOwnerScopeSchema,
    projectId: z.string().nullable(),
    revision: resourceVersionSchema,
    status: integrationStatusSchema,
    tenantId: z.string().nullable(),
    testedAt: z.iso.datetime().nullable(),
    usedAt: z.iso.datetime().nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    version: resourceVersionSchema,
  })
  .strict();

export const credentialPageSchema = z
  .object({
    items: z.array(credentialSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const credentialVerificationResponseSchema = z
  .object({
    credential: credentialSummarySchema,
    errorCategory: errorCategorySchema.optional(),
    errorDetail: z.string().min(1).max(500).optional(),
    outcome: z.enum(['success', 'failed']),
  })
  .strict();

export const adminOperationStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const adminOperationReferenceSchema = z
  .object({
    operationId: z.string().min(1),
    status: adminOperationStatusSchema,
    statusUrl: z.string().startsWith('/api/v1/operations/'),
  })
  .strict();

export const adminOperationSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    status: adminOperationStatusSchema,
    progress: z.number().int().min(0).max(100),
    version: resourceVersionSchema,
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    error: z
      .object({
        category: errorCategorySchema,
        code: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const cursorPageSchema = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextCursor: z.string().min(1).nullable(),
    })
    .strict();

export const webbinPilotBinding = {
  projectKey: 'webbin',
  productionBranch: 'main',
  productionOrigin: 'https://webbin.com.mx',
  repository: 'arrobabeto/webbin',
  tenantKey: 'webbin',
} as const;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export const readinessResponseSchema = z
  .object({
    checks: z.record(
      z.string(),
      z.enum(['ready', 'unavailable', 'stale', 'misconfigured']),
    ),
    status: z.enum(['ready', 'not_ready']),
    timestamp: z.iso.datetime(),
  })
  .strict();

export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;
export type TranslationPolicy = z.infer<typeof translationPolicySchema>;
export type ProjectBudgetPolicy = z.infer<typeof projectBudgetPolicySchema>;
export type ProjectProfile = z.infer<typeof projectProfileSchema>;
export type IntegrationKind = z.infer<typeof integrationKindSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type CredentialOwnerScope = z.infer<typeof credentialOwnerScopeSchema>;
export type IntegrationCandidateInput = z.infer<
  typeof integrationCandidateInputSchema
>;
export type CredentialSummary = z.infer<typeof credentialSummarySchema>;
export type CredentialVerificationResponse = z.infer<
  typeof credentialVerificationResponseSchema
>;
export type ErrorCategory = z.infer<typeof errorCategorySchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type CursorQuery = z.infer<typeof cursorQuerySchema>;
export type AdminOperationStatus = z.infer<typeof adminOperationStatusSchema>;
export type AdminOperationReference = z.infer<
  typeof adminOperationReferenceSchema
>;
export type AdminOperation = z.infer<typeof adminOperationSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const platformOwnerSessionSchema = z
  .object({
    actorId: z.string().min(1),
    email: z.email(),
    fresh: z.boolean(),
    role: z.literal('platform_owner'),
    twoFactor: z.literal(true),
  })
  .strict();

export type PlatformOwnerSessionResponse = z.infer<
  typeof platformOwnerSessionSchema
>;

export const enrollmentStateSchema = z.enum([
  'draft',
  'configuring',
  'validating',
  'validation_failed',
  'ready_for_pairing',
  'pairing_pending',
  'active',
  'revalidation_required',
  'suspended',
  'archived',
]);

const enrollmentKeySchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const httpsUrlSchema = z.url().refine((value) => value.startsWith('https://'), {
  message: 'URL must use HTTPS.',
});

export const capabilityBindingSchema = z
  .object({
    access: z.enum([
      'disabled',
      'client_publish',
      'admin_required',
      'admin_only',
    ]),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
  })
  .strict();

export const enrollmentConfigurationSchema = z
  .object({
    budgetPolicy: projectBudgetPolicySchema.optional(),
    clientContactEmail: z.email().optional(),
    clientConversationLocale: supportedLocaleSchema.optional(),
    contentLocales: z.array(supportedLocaleSchema).min(1).max(3).optional(),
    defaultContentLocale: supportedLocaleSchema.optional(),
    editorialAudience: z.string().min(1).max(2000).optional(),
    editorialVoice: z.string().min(1).max(2000).optional(),
    enabledCapabilities: z.array(capabilityBindingSchema).max(10).optional(),
    previewDomain: httpsUrlSchema.optional(),
    productionDomain: httpsUrlSchema.optional(),
    prohibitedClaims: z.array(z.string().min(1).max(500)).max(50).optional(),
    requiredLocales: z.array(supportedLocaleSchema).min(1).max(3).optional(),
    researchPolicy: z.string().min(1).max(2000).optional(),
    slugLocale: supportedLocaleSchema.optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    translationPolicy: translationPolicySchema.optional(),
  })
  .strict();

export const createEnrollmentInputSchema = z
  .object({
    projectDisplayName: z.string().min(1).max(120),
    projectKey: enrollmentKeySchema,
    projectProfile: selectableEnrollmentProfileSchema.default('astro_repo'),
    tenantDisplayName: z.string().min(1).max(120),
    tenantKey: enrollmentKeySchema,
  })
  .strict();

export const updateEnrollmentInputSchema = z
  .object({
    configuration: enrollmentConfigurationSchema,
    currentStep: z.number().int().min(1).max(11),
  })
  .strict();

export const enrollmentSchema = z
  .object({
    configuration: enrollmentConfigurationSchema,
    createdAt: z.iso.datetime(),
    currentStep: z.number().int().min(1).max(11),
    id: z.string().min(1),
    lastValidatedAt: z.iso.datetime().nullable(),
    projectId: z.string().min(1),
    projectKey: enrollmentKeySchema,
    projectProfile: z.string().min(1),
    state: enrollmentStateSchema,
    tenantId: z.string().min(1),
    tenantKey: enrollmentKeySchema,
    updatedAt: z.iso.datetime(),
    version: resourceVersionSchema,
  })
  .strict();

export const enrollmentValidationAttemptSchema = z
  .object({
    checkName: z.string().min(1),
    checkedAt: z.iso.datetime(),
    errorCategory: z.string().nullable(),
    errorCode: z.string().nullable(),
    evidence: z.record(z.string(), z.unknown()),
    result: z.enum(['success', 'failed', 'blocked']),
  })
  .strict();

export const enrollmentValidationResponseSchema = z
  .object({
    attempts: z.array(enrollmentValidationAttemptSchema),
    enrollment: enrollmentSchema,
  })
  .strict();

export const pairingLinkResponseSchema = z
  .object({
    enrollment: enrollmentSchema,
    expiresAt: z.iso.datetime(),
    pairingUrl: z.url(),
  })
  .strict();

export const enrollmentPageSchema = z
  .object({
    items: z.array(enrollmentSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const activationBlockersResponseSchema = z
  .object({
    blockers: z.array(z.string().min(1)),
    ready: z.boolean(),
  })
  .strict();

export type EnrollmentState = z.infer<typeof enrollmentStateSchema>;
export type EnrollmentConfiguration = z.infer<
  typeof enrollmentConfigurationSchema
>;
export type CreateEnrollmentInput = z.infer<typeof createEnrollmentInputSchema>;
export type SelectableEnrollmentProfile = z.infer<
  typeof selectableEnrollmentProfileSchema
>;
export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentInputSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type EnrollmentValidationAttempt = z.infer<
  typeof enrollmentValidationAttemptSchema
>;

export const projectManifestStatusSchema = z.enum([
  'draft',
  'validated',
  'active',
  'superseded',
]);

export const sourceReferenceSchema = z
  .object({
    kind: z.enum(['url', 'telegram_document', 'project_content']),
    value: z.string().min(1).max(2048),
  })
  .strict();

const createBlogSharedSchema = {
  category: z.string().trim().min(1).max(120).optional(),
  imageAssetId: z.string().min(1).optional(),
  notes: z.string().max(10_000).optional(),
  projectId: z.string().min(1),
  publicationDate: z.iso.date().optional(),
  sourceLocale: supportedLocaleSchema.optional(),
  sources: z.array(sourceReferenceSchema).max(5).optional(),
} as const;

export const createBlogDraftInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      ...createBlogSharedSchema,
      audience: z.string().trim().min(1).max(2000).optional(),
      context: z.string().trim().min(1).max(10_000).optional(),
      internalLinks: z.array(z.string().min(1).max(2048)).max(20).optional(),
      keywords: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
      mode: z.literal('brief'),
      objective: z.string().trim().min(1).max(2000).optional(),
      topic: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      ...createBlogSharedSchema,
      content: z.string().min(1).max(200_000),
      mode: z.literal('draft'),
      title: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

/** Same input modes as create_blog_draft; locales come from the project manifest. */
export const createBlogOrbitypeInputSchema = createBlogDraftInputSchema;
export type CreateBlogOrbitypeInput = z.infer<typeof createBlogOrbitypeInputSchema>;

export const projectTipoSchema = z.enum([
  'Sitio web',
  'Landing page',
  'Aplicacion web',
  'Ecommerce',
]);

export const projectEstadoSchema = z.enum([
  'Publicado',
  'En progreso',
  'Concepto',
]);

export const publicationIntentSchema = z.enum(['draft', 'publish']);

export const projectImageInputSchema = z
  .object({
    mode: z.enum(['omit', 'generate', 'provided']),
    sourcePath: z.string().min(1).optional(),
  })
  .strict();

export const projectValidationErrorCodeSchema = z.enum([
  'high_content_overlap',
  'slug_collision',
  'project_slug_collision',
  'invalid_enum_value',
  'publication_url_required',
  'privacy_evidence_required',
  'repo_contract_failed',
  'manifest_portfolio_missing',
]);

export const projectSectionSchema = z
  .object({
    challenge: z.string().trim().min(100).max(15_000),
    outcome: z.string().trim().min(80).max(10_000),
    solution: z.string().trim().min(100).max(20_000),
  })
  .strict();

export const localizedProjectCaseStudySchema = z
  .object({
    clienteTipo: z.string().trim().min(3).max(120),
    descriptor: z.string().trim().min(10).max(200),
    estado: z.string().trim().min(1).max(80),
    impacto: z.string().trim().min(40).max(1_000),
    industria: z.string().trim().min(3).max(120),
    resumen: z.string().trim().min(40).max(500),
    rol: z.string().trim().min(3).max(200),
    sections: projectSectionSchema,
    stack: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    tipo: z.string().trim().min(1).max(80),
  })
  .strict();

export const generatedProjectBundleSchema = z
  .object({
    schemaVersion: z.literal('project_bundle.v1').default('project_bundle.v1'),
    confidencial: z.boolean(),
    destacada: z.boolean(),
    en: localizedProjectCaseStudySchema,
    es: localizedProjectCaseStudySchema,
    fecha: z.iso.date(),
    imagePrompt: z.string().trim().min(20).max(2_000),
    imagen: z.string().trim().min(1).max(200).optional(),
    rationale: z
      .object({
        evidenceRefs: z.array(z.string().max(2_048)).max(20),
        limitations: z.array(z.string().max(1_000)).max(10),
        summary: z.string().min(1).max(2_000),
      })
      .strict(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .min(3)
      .max(90),
    url: z.url().optional(),
  })
  .strict();

/**
 * OpenAI Structured Outputs requires every property to be listed as required.
 * Optional domain fields are therefore `.nullable()` here, then normalized away.
 */
const portfolioEnumModelSchema = (
  allowed: readonly string[] | undefined,
): z.ZodType<string> => {
  if (allowed === undefined || allowed.length === 0)
    return z.string().trim().min(1).max(80);
  return z.enum(allowed as [string, ...string[]]);
};

export const buildLocalizedProjectCaseStudyModelSchema = (
  enumFields?: Readonly<Record<string, readonly string[]>>,
) =>
  z
    .object({
      clienteTipo: z.string().trim().min(3).max(120),
      descriptor: z.string().trim().min(10).max(200),
      estado: portfolioEnumModelSchema(enumFields?.estado),
      impacto: z.string().trim().min(40).max(1_000),
      industria: z.string().trim().min(3).max(120),
      resumen: z.string().trim().min(40).max(500),
      rol: z.string().trim().min(3).max(200),
      sections: projectSectionSchema,
      stack: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
      tipo: portfolioEnumModelSchema(enumFields?.tipo),
    })
    .strict();

export const buildGeneratedProjectBundleModelSchema = (
  enumFields?: Readonly<Record<string, readonly string[]>>,
) => {
  const localized = buildLocalizedProjectCaseStudyModelSchema(enumFields);
  return z
    .object({
      schemaVersion: z.literal('project_bundle.v1'),
      confidencial: z.boolean(),
      destacada: z.boolean(),
      en: localized,
      es: localized,
      fecha: z.iso.date(),
      imagePrompt: z.string().trim().min(20).max(2_000),
      imagen: z.string().trim().min(1).max(200).nullable(),
      rationale: z
        .object({
          evidenceRefs: z.array(z.string().max(2_048)).max(20),
          limitations: z.array(z.string().max(1_000)).max(10),
          summary: z.string().min(1).max(2_000),
        })
        .strict(),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .min(3)
        .max(90),
      url: z.string().trim().max(2_048).nullable(),
    })
    .strict();
};

export const generatedProjectBundleModelSchema =
  buildGeneratedProjectBundleModelSchema();

export const normalizeProjectBundleFromModel = (
  raw: unknown,
): z.infer<typeof generatedProjectBundleSchema> => {
  const model = generatedProjectBundleModelSchema.parse(raw);
  const { imagen, url, ...rest } = model;
  const normalizedUrl =
    url === null
      ? undefined
      : z.url().parse(url);
  return generatedProjectBundleSchema.parse({
    ...rest,
    ...(imagen === null ? {} : { imagen }),
    ...(normalizedUrl === undefined ? {} : { url: normalizedUrl }),
  });
};

/** Year-month (YYYY-MM) or full ISO date; normalize to YYYY-MM-01 before bundle. */
export const projectFechaInputSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/u);

export const normalizeProjectFechaToIsoDate = (value: string): string => {
  const trimmed = value.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/u.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(trimmed))
    return `${trimmed.slice(0, 7)}-01`;
  return z.iso.date().parse(trimmed);
};

/** Typed extract from `read_project_url` (HTTP page text + LLM). */
export const projectUrlEvidenceSchema = z
  .object({
    claimedStack: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    claims: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    pageTitle: z.string().trim().min(1).max(300).optional(),
    services: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
    sourceUrl: z.url(),
    summary: z.string().trim().min(1).max(4_000),
  })
  .strict();

export type ProjectUrlEvidence = z.infer<typeof projectUrlEvidenceSchema>;

const createProjectSharedSchema = {
  clientProfile: z.string().trim().min(1).max(80).optional(),
  confidencial: z.boolean().optional(),
  destacada: z.boolean().optional(),
  fecha: projectFechaInputSchema.optional(),
  image: projectImageInputSchema.optional(),
  imageAssetId: z.string().min(1).optional(),
  notes: z.string().max(10_000).optional(),
  projectId: z.string().min(1),
  publicationIntent: publicationIntentSchema.default('draft'),
  sourceLocale: supportedLocaleSchema.optional(),
  stack: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  url: z.url().optional(),
  urlEvidence: projectUrlEvidenceSchema.optional(),
  estado: z.union([projectEstadoSchema, z.string().trim().min(1).max(80)]).optional(),
  tipo: z.union([projectTipoSchema, z.string().trim().min(1).max(80)]).optional(),
} as const;

/** Partial facts collected before plan confirm (base + customization DSL). */
export const projectClosedFactsRecordSchema = z
  .record(z.string().min(1).max(64), z.unknown())
  .default({});

export const createProjectAstroInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      closedFacts: projectClosedFactsRecordSchema,
      collectionComplete: z.boolean().default(false),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      projectId: z.string().min(1),
      publicationIntent: publicationIntentSchema.default('draft'),
    })
    .strict(),
  z
    .object({
      ...createProjectSharedSchema,
      brief: z.string().trim().min(1).max(10_000),
      closedFacts: projectClosedFactsRecordSchema.optional(),
      mode: z.literal('brief'),
    })
    .strict(),
  z
    .object({
      ...createProjectSharedSchema,
      bundle: generatedProjectBundleSchema,
      mode: z.literal('structured'),
    })
    .strict(),
  z
    .object({
      feedback: z.string().trim().min(1).max(10_000),
      mode: z.literal('revision'),
      projectId: z.string().min(1),
    })
    .strict(),
]);

/** @deprecated Use createProjectAstroInputSchema */
export const createProjectDraftInputSchema = createProjectAstroInputSchema;

const deleteBlogSharedSchema = {
  projectId: z.string().min(1),
} as const;

export const deleteBlogDraftInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      closedFacts: projectClosedFactsRecordSchema,
      collectionComplete: z.boolean().default(false),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      resolvedSlug: z.string().min(1).optional(),
      resolvedUrl: z.string().url().optional(),
      targetConfirmed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...deleteBlogSharedSchema,
      mode: z.literal('execute'),
      resolvedSlug: z.string().min(1),
      resolvedTitle: z.string().trim().min(1).max(500).optional(),
      resolvedUrl: z.string().url().optional(),
      targetTitle: z.string().trim().min(1).max(500).optional(),
      targetUrl: z.string().url().optional(),
    })
    .strict(),
]);

const deleteProjectSharedSchema = {
  projectId: z.string().min(1),
} as const;

export const deleteProjectAstroInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      closedFacts: projectClosedFactsRecordSchema,
      collectionComplete: z.boolean().default(false),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      resolvedSlug: z.string().min(1).optional(),
      resolvedUrl: z.string().url().optional(),
      targetConfirmed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...deleteProjectSharedSchema,
      mode: z.literal('execute'),
      resolvedSlug: z.string().min(1),
      resolvedTitle: z.string().trim().min(1).max(500).optional(),
      resolvedUrl: z.string().url().optional(),
      targetTitle: z.string().trim().min(1).max(500).optional(),
      targetUrl: z.string().url().optional(),
    })
    .strict(),
]);

export const menuCtaCandidateSchema = z
  .object({
    currentHref: z.string().trim().min(1).max(500),
    field: z.enum(['ctaHref', 'ctaSecondaryHref']),
    key: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(200),
    pageId: z.string().trim().min(1).max(80),
    pageSlug: z.string().trim().min(1).max(120),
    pageTitle: z.string().trim().min(1).max(200),
    sectionIndex: z.number().int().nonnegative(),
  })
  .strict();

const updateMenuSharedSchema = {
  projectId: z.string().min(1),
} as const;

export const textEditCandidateSchema = z
  .object({
    currentValue: z.string().trim().min(1).max(10_000),
    field: z.string().trim().min(1).max(80),
    key: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(200),
    locale: z.enum(['de', 'en', 'es']),
    pageId: z.string().trim().min(1).max(80),
    pageSlug: z.string().trim().min(1).max(120),
    pageTitle: z.string().trim().min(1).max(200),
    sectionIndex: z.number().int().nonnegative(),
  })
  .strict();

const editTextSharedSchema = {
  projectId: z.string().min(1),
} as const;

export const editTextInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      collectionComplete: z.boolean().default(false),
      collectionStep: z
        .enum([
          'await_locale',
          'await_target',
          'disambiguate',
          'confirm_target',
          'await_replacement',
          'ready',
        ])
        .default('await_target'),
      contentLocale: z.enum(['de', 'en', 'es']).optional(),
      discoveredTargets: z.array(textEditCandidateSchema).max(40).default([]),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      newValue: z.string().trim().max(10_000).optional(),
      projectId: z.string().min(1),
      targetKey: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      ...editTextSharedSchema,
      contentLocale: z.enum(['de', 'en', 'es']),
      mode: z.literal('execute'),
      newValue: z.string().trim().min(1).max(10_000),
      targetKey: z.string().trim().min(1).max(160),
    })
    .strict(),
]);

export const textStylePatchSchema = z
  .object({
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/u)
      .optional(),
    fontSizePx: z.number().int().positive().max(400).optional(),
    fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.color !== undefined ||
      value.fontSizePx !== undefined ||
      value.fontWeight !== undefined,
    { message: 'At least one style attribute is required.' },
  );

const editTextStyleSharedSchema = {
  projectId: z.string().min(1),
} as const;

export const editTextStyleInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      collectionComplete: z.boolean().default(false),
      collectionStep: z
        .enum([
          'await_locale',
          'await_target',
          'disambiguate',
          'confirm_target',
          'await_style',
          'await_style_weight',
          'await_style_size',
          'await_style_color',
          'await_hex',
          'ready',
        ])
        .default('await_target'),
      colorMode: z.enum(['hex', 'darken50', 'lighten50']).optional(),
      contentLocale: z.enum(['de', 'en', 'es']).optional(),
      currentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/u).optional(),
      currentFontSizePx: z.number().int().positive().max(400).optional(),
      currentFontWeight: z
        .union([z.literal(400), z.literal(600), z.literal(700)])
        .optional(),
      discoveredTargets: z.array(textEditCandidateSchema).max(40).default([]),
      fieldKind: z.enum(['heading', 'subtitle', 'body']).optional(),
      fontSizeDeltaPx: z
        .union([z.literal(4), z.literal(8), z.literal(16), z.literal(32)])
        .optional(),
      fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]).optional(),
      hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/u).optional(),
      hexAttempts: z.number().int().min(0).max(2).default(0),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      projectId: z.string().min(1),
      targetExcerpt: z.string().trim().min(1).max(10_000).optional(),
      targetKey: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
  z
    .object({
      ...editTextStyleSharedSchema,
      contentLocale: z.enum(['de', 'en', 'es']),
      mode: z.literal('execute'),
      style: textStylePatchSchema,
      targetExcerpt: z.string().trim().min(1).max(10_000),
      targetKey: z.string().trim().min(1).max(160),
    })
    .strict(),
]);

export const imageEditCandidateSchema = z
  .object({
    currentPath: z.string().trim().min(1).max(500),
    field: z.string().trim().min(1).max(80),
    key: z.string().trim().min(1).max(200),
    kind: z.enum(['page', 'blog']),
    label: z.string().trim().min(1).max(200),
    pageOrPostId: z.string().trim().min(1).max(80),
    pageOrPostSlug: z.string().trim().min(1).max(120),
    pageOrPostTitle: z.string().trim().min(1).max(200),
    sectionIndex: z.number().int(), // allow -1 for blog cover
    component: z.string().trim().max(80).nullable(),
  })
  .strict();

export const editImageInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      collectionComplete: z.boolean().default(false),
      collectionStep: z
        .enum([
          'await_target',
          'disambiguate',
          'confirm_target',
          'await_replacement',
          'ready',
        ])
        .default('await_target'),
      discoveredTargets: z.array(imageEditCandidateSchema).max(40).default([]),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      projectId: z.string().min(1),
      replacementArtifactKey: z.string().trim().min(1).max(500).optional(),
      replacementMime: z.string().trim().min(1).max(80).optional(),
      replacementSourceUrl: z.string().url().optional(),
      targetKey: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('execute'),
      projectId: z.string().min(1),
      targetKey: z.string().trim().min(1).max(200),
      replacementArtifactKey: z.string().trim().min(1).max(500),
      replacementMime: z.string().trim().min(1).max(80),
      replacementSourceUrl: z.string().url().optional(),
    })
    .strict(),
]);

export const updateMenuInputSchema = z.discriminatedUnion('mode', [
  z
    .object({
      collectionComplete: z.boolean().default(false),
      collectionStep: z
        .enum(['await_pdf', 'select_ctas', 'ready'])
        .default('await_pdf'),
      discoveredCtas: z.array(menuCtaCandidateSchema).max(40).default([]),
      menuPdfPublicPath: z.string().trim().min(1).max(200).optional(),
      messages: z.array(z.string().trim().max(10_000)).max(40).default([]),
      mode: z.literal('collect'),
      pdfArtifactKey: z.string().trim().min(1).max(500).optional(),
      pdfFileName: z.string().trim().min(1).max(200).optional(),
      projectId: z.string().min(1),
      selectedCtaKeys: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    })
    .strict(),
  z
    .object({
      ...updateMenuSharedSchema,
      menuPdfPublicPath: z.string().trim().min(1).max(200),
      menuPdfPublicUrl: z.string().url(),
      mode: z.literal('execute'),
      pdfArtifactKey: z.string().trim().min(1).max(500),
      pdfFileName: z.string().trim().min(1).max(200),
      selectedCtaKeys: z.array(z.string().trim().min(1).max(120)).min(1).max(40),
    })
    .strict(),
]);

export const openTicketCollectInputSchema = z
  .object({
    collectionStep: z.enum([
      'await_choice',
      'await_requirement',
      'await_scope',
      'await_intent',
      'await_urgency',
      'await_kind',
      'await_confirm',
    ]),
    effortEstimate: z.string().max(2_000).optional(),
    intent: z.string().max(4_000).optional(),
    kind: z.enum(['improvement', 'style', 'bug']).optional(),
    mode: z.literal('open_ticket_collect'),
    projectId: z.string().min(1),
    requirement: z.string().max(4_000).optional(),
    scope: z.string().max(4_000).optional(),
    seedText: z.string().max(4_000).optional(),
    summary: z.string().max(8_000).optional(),
    title: z.string().max(240).optional(),
    urgency: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  })
  .strict();

export const capabilityInputSchema = z.union([
  createBlogDraftInputSchema,
  createProjectAstroInputSchema,
  deleteBlogDraftInputSchema,
  deleteProjectAstroInputSchema,
  editTextInputSchema,
  editTextStyleInputSchema,
  editImageInputSchema,
  updateMenuInputSchema,
  openTicketCollectInputSchema,
]);

export const capabilityCatalogItemSchema = z
  .object({
    access: z.enum([
      'disabled',
      'client_publish',
      'admin_required',
      'admin_only',
    ]),
    command: z.string().min(1),
    displayName: z.string().min(1),
    enabled: z.boolean(),
    id: z.string().min(1),
    requiresPreview: z.boolean(),
    riskClass: z.enum(['low', 'medium', 'high']),
    version: z.number().int().positive(),
  })
  .strict();

export const capabilityCatalogResponseSchema = z
  .object({
    items: z.array(capabilityCatalogItemSchema),
    manifestVersion: z.number().int().positive().nullable(),
    projectId: z.string().min(1),
  })
  .strict();

export const updateProjectCapabilitiesInputSchema = z
  .object({
    bindings: z.array(capabilityBindingSchema).min(1).max(10),
  })
  .strict();

export const toolAssignmentSchema = z
  .object({
    access: capabilityBindingSchema.shape.access,
    enrollmentId: z.string().min(1),
    manifestVersion: z.number().int().positive(),
    projectId: z.string().min(1),
    projectKey: enrollmentKeySchema,
    tenantKey: enrollmentKeySchema,
  })
  .strict();

export const toolAssignmentsResponseSchema = z
  .object({
    items: z.array(toolAssignmentSchema),
  })
  .strict();

const manifestCollectionSchema = z
  .object({
    directory: z.string().min(1),
    routePrefix: z.string().startsWith('/'),
  })
  .strict();

const manifestSectionHeadingsSchema = z
  .object({
    challenge: z.string().min(1),
    outcome: z.string().min(1),
    solution: z.string().min(1),
  })
  .strict();

const manifestPortfolioSchema = z
  .object({
    collections: z
      .partialRecord(supportedLocaleSchema, manifestCollectionSchema)
      .refine((collections) => Object.keys(collections).length > 0),
    editablePaths: z.array(z.string().min(1)).min(1),
    enumFields: z
      .record(z.string(), z.array(z.string().min(1)).min(1))
      .optional(),
    frontmatterFields: z.array(z.string().min(1)).min(1),
    imageDirectory: z.string().min(1),
    requiredFrontmatter: z.array(z.string().min(1)).min(1),
    sectionHeadings: z
      .partialRecord(supportedLocaleSchema, manifestSectionHeadingsSchema)
      .refine((headings) => Object.keys(headings).length > 0),
  })
  .strict();

export const projectManifestSchema = z
  .object({
    budgetPolicy: projectBudgetPolicySchema,
    content: z
      .object({
        blockedPaths: z.array(z.string().min(1)).min(1),
        collections: z
          .partialRecord(supportedLocaleSchema, manifestCollectionSchema)
          .refine((collections) => Object.keys(collections).length > 0),
        editablePaths: z.array(z.string().min(1)).min(1),
        frontmatterFields: z.array(z.string().min(1)).min(1),
        imageDirectory: z.string().min(1),
        portfolio: manifestPortfolioSchema.optional(),
        publicationTargets: z
          .array(z.enum(['github', 'orbitype']))
          .min(1)
          .max(2)
          .optional(),
        source: z.enum(['github', 'orbitype']),
      })
      .strict(),
    contentLocales: z.array(supportedLocaleSchema).min(1).max(3),
    conversationLocale: supportedLocaleSchema,
    defaultContentLocale: supportedLocaleSchema,
    deployment: z
      .object({
        previewMode: z.enum(['git_integration', 'ci', 'api']),
        /**
         * Client-visible live site origin (HTTPS, no trailing slash).
         * Frozen from enrollment `productionDomain` (ADR-0048).
         */
        productionOrigin: httpsUrlSchema.optional(),
        projectId: z.string().min(1),
        protectionMode: z.enum(['vercel_auth', 'share_link', 'public']),
        provider: z.literal('vercel'),
        teamId: z.string().min(1).optional(),
      })
      .strict(),
    enabledCapabilities: z.array(capabilityBindingSchema),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    globalProfileVersion: z.string().min(1),
    graphVersion: z.string().min(1),
    id: z.string().min(1),
    profile: selectableEnrollmentProfileSchema,
    projectId: z.string().min(1),
    repository: z
      .object({
        branchPattern: z.string().min(1),
        githubInstallationId: z.string().min(1),
        name: z.string().min(1),
        owner: z.string().min(1),
        productionBranch: z.string().min(1),
      })
      .strict(),
    requiredContentLocales: z.array(supportedLocaleSchema).min(1).max(3),
    rulesVersion: z.string().min(1),
    slugLocale: supportedLocaleSchema,
    status: projectManifestStatusSchema,
    translationPolicy: translationPolicySchema,
    validationProfileId: z.string().min(1),
    validatedAt: z.iso.datetime(),
    version: resourceVersionSchema,
  })
  .strict();

export const globalProfileSummarySchema = z
  .object({
    id: selectableEnrollmentProfileSchema,
    supportedLocales: z.array(supportedLocaleSchema),
    version: z.string().min(1),
  })
  .strict();

export const projectManifestResponseSchema = z
  .object({
    globalProfile: globalProfileSummarySchema,
    manifest: projectManifestSchema.nullable(),
  })
  .strict();

export type ProjectManifestStatus = z.infer<typeof projectManifestStatusSchema>;
export type CapabilityBinding = z.infer<typeof capabilityBindingSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type CreateBlogDraftInput = z.infer<typeof createBlogDraftInputSchema>;
export type DeleteBlogDraftInput = z.infer<typeof deleteBlogDraftInputSchema>;
export type UpdateMenuInput = z.infer<typeof updateMenuInputSchema>;
export type EditTextInput = z.infer<typeof editTextInputSchema>;
export type EditTextStyleInput = z.infer<typeof editTextStyleInputSchema>;
export type TextStylePatch = z.infer<typeof textStylePatchSchema>;
export type TextEditCandidate = z.infer<typeof textEditCandidateSchema>;
export type EditImageInput = z.infer<typeof editImageInputSchema>;
export type ImageEditCandidate = z.infer<typeof imageEditCandidateSchema>;
export type OpenTicketCollectInput = z.infer<typeof openTicketCollectInputSchema>;
export type DeleteProjectAstroInput = z.infer<typeof deleteProjectAstroInputSchema>;
export type CreateProjectAstroInput = z.infer<typeof createProjectAstroInputSchema>;
/** @deprecated Use CreateProjectAstroInput */
export type CreateProjectDraftInput = CreateProjectAstroInput;
export type CapabilityInput = z.infer<typeof capabilityInputSchema>;
export type CapabilityId = z.infer<typeof capabilityIdSchema>;
export type GeneratedProjectBundle = z.infer<typeof generatedProjectBundleSchema>;
export type LocalizedProjectCaseStudy = z.infer<
  typeof localizedProjectCaseStudySchema
>;
export type CapabilityCatalogItem = z.infer<typeof capabilityCatalogItemSchema>;
export type CapabilityCatalogResponse = z.infer<
  typeof capabilityCatalogResponseSchema
>;
export type UpdateProjectCapabilitiesInput = z.infer<
  typeof updateProjectCapabilitiesInputSchema
>;
export type ToolAssignment = z.infer<typeof toolAssignmentSchema>;
export type ToolAssignmentsResponse = z.infer<
  typeof toolAssignmentsResponseSchema
>;

export const requestStateSchema = z.enum([
  'RECEIVED',
  'NEEDS_INPUT',
  'AWAITING_PLAN_CONFIRMATION',
  'QUEUED',
  'GENERATING',
  'APPLYING_CHANGE',
  'VALIDATING',
  'PREVIEW_DEPLOYING',
  'PREVIEW_READY',
  'REVISION_REQUESTED',
  'AWAITING_REVISION_PLAN_CONFIRMATION',
  'AWAITING_CLIENT_APPROVAL',
  'AWAITING_ADMIN_APPROVAL',
  'APPROVED_FOR_PUBLISH',
  'REVALIDATING',
  'MERGING_OR_PUBLISHING',
  'PRODUCTION_DEPLOYING',
  'VERIFYING_PRODUCTION',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'CANCELLED',
  'SUPERSEDED',
]);

export const capabilityIdSchema = z.enum([
  'create_blog_draft',
  'create_blog_orbitype',
  'create_project_astro',
  'create_project_draft',
  'delete_blog_draft',
  'delete_project_astro',
  'edit_image',
  'edit_text',
  'edit_text_style',
  'open_ticket',
  'update_menu',
]);

export const requestSummarySchema = z
  .object({
    approvalStatus: z
      .string()
      .min(1)
      .nullish()
      .transform((value) => value ?? null),
    capabilityId: capabilityIdSchema,
    clientKey: z.string().min(1),
    clientName: z.string().min(1),
    createdAt: z.iso.datetime(),
    currentVersion: z.number().int().positive(),
    id: z.string().min(1),
    projectId: z.string().min(1),
    revision: z.number().int().positive(),
    state: requestStateSchema,
    tenantId: z.string().min(1),
    topic: z.string().min(1).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const requestStageSchema = z
  .object({
    createdAt: z.iso.datetime(),
    node: z.string().min(1),
    sequence: z.number().int().positive(),
    summary: z.string().min(1),
  })
  .strict();

export const requestFailureSchema = z
  .object({
    category: errorCategorySchema,
    detail: z.string().min(1).max(500).optional(),
    message: z.string().min(1),
    node: z.string().min(1),
  })
  .strict();

export const summarizeRequestStageSummary = (
  state: Record<string, unknown>,
): string => {
  const parts: string[] = [];
  if (typeof state.requestState === 'string') parts.push(state.requestState);
  if (typeof state.errorCategory === 'string') parts.push(state.errorCategory);
  return parts.length > 0 ? parts.join(' · ') : 'In progress';
};

export const projectRequestFailure = (
  terminalResult: unknown,
  fallbackNode?: string,
): z.infer<typeof requestFailureSchema> | null => {
  if (terminalResult === null || typeof terminalResult !== 'object')
    return null;
  const record = terminalResult as Record<string, unknown>;
  const category = record.errorCategory;
  const message = record.errorMessage;
  if (typeof category !== 'string' || typeof message !== 'string') return null;
  const node =
    typeof record.failedNode === 'string'
      ? record.failedNode
      : (fallbackNode ?? 'failed');
  const detail =
    typeof record.errorDetail === 'string' && record.errorDetail.length > 0
      ? record.errorDetail.slice(0, 500)
      : undefined;
  return requestFailureSchema.parse({
    category,
    message,
    node,
    ...(detail === undefined ? {} : { detail }),
  });
};

const parsePullRequestUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = z.url().safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const requestExecutionSchema = z
  .object({
    approvalStatus: z.string().nullable(),
    branch: z.string().nullable(),
    categoryKind: z.enum(['existing', 'likely_typo', 'new']).nullable(),
    destacada: z.boolean().nullable(),
    files: z.array(z.string()),
    headCommitSha: z.string().nullable(),
    previewDeploymentId: z.string().nullable(),
    previewUrls: z.record(z.string(), z.string()),
    pullRequestUrl: z.url().nullable(),
    slug: z.string().nullable(),
  })
  .strict();

export const parseRequestExecution = (
  terminalResult: unknown,
): z.infer<typeof requestExecutionSchema> | null => {
  if (terminalResult === null || typeof terminalResult !== 'object') return null;
  const record = terminalResult as Record<string, unknown>;
  const categoryKind = record.categoryKind;
  return requestExecutionSchema.parse({
    approvalStatus:
      typeof record.approvalStatus === 'string' ? record.approvalStatus : null,
    branch: typeof record.branch === 'string' ? record.branch : null,
    categoryKind:
      categoryKind === 'existing' ||
      categoryKind === 'likely_typo' ||
      categoryKind === 'new'
        ? categoryKind
        : null,
    destacada: typeof record.destacada === 'boolean' ? record.destacada : null,
    files: Array.isArray(record.files)
      ? record.files.filter((file): file is string => typeof file === 'string')
      : [],
    headCommitSha:
      typeof record.headCommitSha === 'string' ? record.headCommitSha : null,
    previewDeploymentId:
      typeof record.previewDeploymentId === 'string'
        ? record.previewDeploymentId
        : null,
    previewUrls:
      typeof record.previewUrls === 'object' &&
      record.previewUrls !== null &&
      !Array.isArray(record.previewUrls)
        ? Object.fromEntries(
            Object.entries(record.previewUrls as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === 'string' && typeof entry[1] === 'string',
            ),
          )
        : {},
    pullRequestUrl: parsePullRequestUrl(record.pullRequestUrl),
    slug: typeof record.slug === 'string' ? record.slug : null,
  });
};

export const requestDetailSchema = requestSummarySchema.extend({
  confirmedAt: z.iso.datetime().nullable(),
  execution: requestExecutionSchema.nullable(),
  failure: requestFailureSchema.nullable(),
  interpretedInput: capabilityInputSchema.nullable(),
  plan: z.record(z.string(), z.unknown()).nullable(),
  stages: z.array(requestStageSchema),
});

export const blogFaqSchema = z
  .object({
    pregunta: z.string().trim().min(1).max(300),
    respuesta: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const localizedBlogArticleSchema = z
  .object({
    body: z.string().min(500).max(100_000),
    categoria: z.string().trim().min(1).max(120),
    descripcion: z.string().trim().min(40).max(300),
    faq: z.array(blogFaqSchema).min(2).max(8),
    imagenAlt: z.string().trim().min(10).max(300),
    keywords: z.array(z.string().trim().min(1).max(100)).min(3).max(20),
    seoTitulo: z.string().trim().min(10).max(80),
    tiempoLectura: z.number().int().min(1).max(60),
    titulo: z.string().trim().min(10).max(200),
  })
  .strict();

export const generatedBlogBundleSchema = z
  .object({
    category: z.string().trim().min(1).max(120),
    categoryKind: z.enum(['existing', 'likely_typo', 'new']),
    en: localizedBlogArticleSchema,
    es: localizedBlogArticleSchema,
    imagePrompt: z.string().trim().min(20).max(2_000),
    rationale: z
      .object({
        evidenceRefs: z.array(z.string().max(2_048)).max(20),
        limitations: z.array(z.string().max(1_000)).max(10),
        summary: z.string().min(1).max(2_000),
      })
      .strict(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

const comparableLocaleText = (value: string): string =>
  value.trim().replace(/\s+/gu, ' ').toLowerCase();

export const markdownHeadings = (body: string): readonly string[] =>
  [...body.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gmu)].flatMap((match) => {
    const heading = match[1]?.trim();
    return heading === undefined || heading.length === 0 ? [] : [heading];
  });

const copiedSpanishField = (english: string, spanish: string): boolean =>
  comparableLocaleText(english) === comparableLocaleText(spanish);

export const englishBlogBundleCopiesSpanish = (
  bundle: Readonly<{
    en: z.infer<typeof localizedBlogArticleSchema>;
    es: z.infer<typeof localizedBlogArticleSchema>;
  }>,
): boolean => {
  if (copiedSpanishField(bundle.en.titulo, bundle.es.titulo)) return true;
  if (copiedSpanishField(bundle.en.seoTitulo, bundle.es.seoTitulo)) return true;
  if (copiedSpanishField(bundle.en.descripcion, bundle.es.descripcion))
    return true;
  if (copiedSpanishField(bundle.en.imagenAlt, bundle.es.imagenAlt)) return true;
  const spanishHeadings = new Set(
    markdownHeadings(bundle.es.body).map(comparableLocaleText),
  );
  if (
    markdownHeadings(bundle.en.body).some((heading) =>
      spanishHeadings.has(comparableLocaleText(heading)),
    )
  )
    return true;
  const spanishQuestions = new Set(
    bundle.es.faq.map((entry) => comparableLocaleText(entry.pregunta)),
  );
  return bundle.en.faq.some((entry) =>
    spanishQuestions.has(comparableLocaleText(entry.pregunta)),
  );
};

export const adaptedGeneratedBlogBundleSchema =
  generatedBlogBundleSchema.superRefine((bundle, ctx) => {
    if (!englishBlogBundleCopiesSpanish(bundle)) return;
    ctx.addIssue({
      code: 'custom',
      message:
        'English titulo, seoTitulo, description, alt text, FAQ questions and Markdown headings must be an idiomatic adaptation, not a copy of the Spanish source.',
      path: ['en'],
    });
  });

export const englishProjectBundleCopiesSpanish = (
  bundle: Readonly<{
    en: z.infer<typeof localizedProjectCaseStudySchema>;
    es: z.infer<typeof localizedProjectCaseStudySchema>;
  }>,
): boolean => {
  if (copiedSpanishField(bundle.en.descriptor, bundle.es.descriptor)) return true;
  if (copiedSpanishField(bundle.en.resumen, bundle.es.resumen)) return true;
  if (copiedSpanishField(bundle.en.impacto, bundle.es.impacto)) return true;
  return false;
};

export const adaptedGeneratedProjectBundleSchema =
  generatedProjectBundleSchema.superRefine((bundle, ctx) => {
    if (!englishProjectBundleCopiesSpanish(bundle)) return;
    ctx.addIssue({
      code: 'custom',
      message:
        'English descriptor, resumen and impacto must be an idiomatic adaptation, not a copy of the Spanish source.',
      path: ['en'],
    });
  });

export const revisionMagnitudeSchema = z.enum([
  'title_locales',
  'metadata',
  'body_patch',
  'image_only',
  'full_regenerate',
]);

export const revisionOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      locale: z.enum(['es', 'en']),
      op: z.literal('set_title'),
      seoTitulo: z.string().trim().min(10).max(80).optional(),
      titulo: z.string().trim().min(10).max(200),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(4_000),
      locale: z.enum(['es', 'en']),
      op: z.literal('patch_body'),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(4_000),
      op: z.literal('replace_image'),
    })
    .strict(),
  z
    .object({
      fields: z
        .object({
          descripcion: z.string().trim().min(1).max(500).optional(),
          faq: z.array(blogFaqSchema).max(8).optional(),
          imagenAlt: z.string().trim().min(10).max(300).optional(),
          keywords: z
            .array(z.string().trim().min(1).max(100))
            .max(20)
            .optional(),
        })
        .strict(),
      locale: z.enum(['es', 'en']),
      op: z.literal('patch_metadata'),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(4_000),
      op: z.literal('regenerate_all'),
    })
    .strict(),
]);

export const revisionPlanSchema = z
  .object({
    localesAffected: z.array(z.enum(['es', 'en'])).min(1).max(2),
    magnitude: revisionMagnitudeSchema,
    operations: z.array(revisionOperationSchema).min(1).max(20),
    preservesSlug: z.boolean(),
    rationale: z.string().trim().min(1).max(2_000),
    requiresFullRegeneration: z.boolean(),
    summary: z.string().trim().min(1).max(1_500),
  })
  .strict();

export const revisionPlanValidatedSchema = revisionPlanSchema.superRefine(
  (plan, ctx) => {
    if (
      plan.magnitude === 'full_regenerate' &&
      !plan.requiresFullRegeneration
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'full_regenerate requires requiresFullRegeneration=true.',
        path: ['requiresFullRegeneration'],
      });
    }
    if (
      plan.magnitude !== 'full_regenerate' &&
      plan.requiresFullRegeneration
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'requiresFullRegeneration is only valid with full_regenerate magnitude.',
        path: ['requiresFullRegeneration'],
      });
    }
  },
);

/**
 * OpenAI Structured Outputs requires every property to be listed as required.
 * Optional domain fields are therefore `.nullable()` here, then normalized away.
 */
export const revisionOperationModelSchema = z.discriminatedUnion('op', [
  z
    .object({
      locale: z.enum(['es', 'en']),
      op: z.literal('set_title'),
      seoTitulo: z.string().trim().min(10).max(80).nullable(),
      titulo: z.string().trim().min(10).max(200),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(4_000),
      locale: z.enum(['es', 'en']),
      op: z.literal('patch_body'),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(4_000),
      op: z.literal('replace_image'),
    })
    .strict(),
  z
    .object({
      fields: z
        .object({
          descripcion: z.string().trim().min(1).max(500).nullable(),
          faq: z.array(blogFaqSchema).max(8).nullable(),
          imagenAlt: z.string().trim().min(10).max(300).nullable(),
          keywords: z
            .array(z.string().trim().min(1).max(100))
            .max(20)
            .nullable(),
        })
        .strict(),
      locale: z.enum(['es', 'en']),
      op: z.literal('patch_metadata'),
    })
    .strict(),
  z
    .object({
      instruction: z.string().trim().min(1).max(4_000),
      op: z.literal('regenerate_all'),
    })
    .strict(),
]);

export const revisionPlanModelSchema = z
  .object({
    localesAffected: z.array(z.enum(['es', 'en'])).min(1).max(2),
    magnitude: revisionMagnitudeSchema,
    operations: z.array(revisionOperationModelSchema).min(1).max(20),
    preservesSlug: z.boolean(),
    rationale: z.string().trim().min(1).max(2_000),
    requiresFullRegeneration: z.boolean(),
    summary: z.string().trim().min(1).max(1_500),
  })
  .strict();

export const normalizeRevisionPlanFromModel = (
  raw: unknown,
): z.infer<typeof revisionPlanSchema> => {
  const model = revisionPlanModelSchema.parse(raw);
  const operations = model.operations.map((operation) => {
    if (operation.op === 'set_title') {
      return {
        locale: operation.locale,
        op: 'set_title' as const,
        titulo: operation.titulo,
        ...(operation.seoTitulo === null
          ? {}
          : { seoTitulo: operation.seoTitulo }),
      };
    }
    if (operation.op === 'patch_metadata') {
      return {
        fields: {
          ...(operation.fields.descripcion === null
            ? {}
            : { descripcion: operation.fields.descripcion }),
          ...(operation.fields.faq === null
            ? {}
            : { faq: operation.fields.faq }),
          ...(operation.fields.imagenAlt === null
            ? {}
            : { imagenAlt: operation.fields.imagenAlt }),
          ...(operation.fields.keywords === null
            ? {}
            : { keywords: operation.fields.keywords }),
        },
        locale: operation.locale,
        op: 'patch_metadata' as const,
      };
    }
    return operation;
  });
  return revisionPlanValidatedSchema.parse({
    ...model,
    operations,
  });
};

export const requestPageSchema = cursorPageSchema(requestSummarySchema);

export const requestRevisionInputSchema = z
  .object({ feedback: z.string().trim().min(1).max(4_000) })
  .strict();

export const telegramIngressSchema = z
  .object({
    botId: z.string().regex(/^\d+$/),
    chatId: z.string().regex(/^-?\d+$/),
    documentArtifactKey: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[a-z0-9][a-z0-9/_\-.]{1,500}$/u)
      .optional(),
    externalUserId: z.string().regex(/^\d+$/),
    imageArtifactKey: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .regex(/^[a-z0-9][a-z0-9/_\-.]{1,500}$/u)
      .optional(),
    receivedAt: z.iso.datetime(),
    text: z.string().max(4096).default(''),
    updateId: z.string().regex(/^\d+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.text.trim().length === 0 &&
      value.imageArtifactKey === undefined &&
      value.documentArtifactKey === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Telegram ingress requires text, an image attachment, or a document attachment.',
        path: ['text'],
      });
    }
  });

export const telegramReplySchema = z
  .object({
    actionTokens: z
      .array(
        z
          .object({
            action: z.enum([
              'confirm_plan',
              'confirm_delete_target',
              'confirm_menu_selection',
              'select_all_menu_ctas',
              'confirm_text_plan',
              'confirm_text_target',
              'pick_text_locale',
              'pick_text_target',
              'confirm_text_style_plan',
              'confirm_text_style_target',
              'pick_text_style_locale',
              'pick_text_style_target',
              'pick_text_style_attr',
              'pick_text_style_weight',
              'pick_text_style_size',
              'pick_text_style_color',
              'done_text_style_attrs',
              'pick_image_target',
              'confirm_image_target',
              'reject_image_target',
              'confirm_image_plan',
              'approve_preview',
              'request_revision',
              'confirm_revision_plan',
              'adjust_revision_plan',
              'cancel_revision',
              'toggle_menu_cta',
              'start_open_ticket',
              'show_tools',
              'pick_ticket_urgency',
              'pick_ticket_kind',
              'confirm_ticket_send',
              'cancel',
              'approve_publish',
              'reject',
            ]),
            label: z.string().min(1),
            token: z.string().min(32),
          })
          .strict(),
      )
      .default([]),
    duplicate: z.boolean().default(false),
    locale: supportedLocaleSchema,
    photoUrl: z.string().url().optional(),
    requestId: z.string().min(1).nullable(),
    text: z.string().min(1),
  })
  .strict();

export const workflowResumeSignalSchema = z
  .object({
    reason: z
      .enum([
        'execute',
        'interpret_revision',
        'apply_revision',
        'publish',
        'reconcile',
        'restore_orbitype_preview',
      ])
      .default('execute'),
    requestId: z.string().min(1),
    requestVersionId: z.string().min(1),
    tenantId: z.string().min(1),
  })
  .strict();

export const toolCatalogItemSchema = z
  .object({
    assignedClientCount: z.number().int().nonnegative(),
    command: z.string().min(1),
    displayName: z.string().min(1),
    graphVersion: z.string().min(1),
    id: z.string().min(1),
    nodeCount: z.number().int().positive(),
    profile: z.string().min(1),
    requiresPreview: z.boolean(),
    riskClass: z.enum(['low', 'medium', 'high']),
    stack: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

export const toolCatalogResponseSchema = z
  .object({
    items: z.array(toolCatalogItemSchema),
  })
  .strict();

export const toolGraphNodeSchema = z
  .object({
    acceptsClientCustomization: z.boolean(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    id: z.string().min(1),
    kind: z.enum(['compute', 'agent', 'effect', 'interrupt']),
    label: z.string().min(1),
    model: z.string().min(1).optional(),
    nodeKind: z.string().min(1),
    rulesMarkdown: z.string(),
    workload: z.enum(['text', 'embedding', 'image']).optional(),
  })
  .strict();

export const toolGraphEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict();

export const toolGraphResponseSchema = z
  .object({
    customizationTemplate: z.string().min(1),
    edges: z.array(toolGraphEdgeSchema),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    graphVersion: z.string().min(1),
    nodes: z.array(toolGraphNodeSchema),
    tool: toolCatalogItemSchema.omit({ assignedClientCount: true }),
  })
  .strict();

export const toolCustomizationSummarySchema = z
  .object({
    capabilityId: z.string().min(1),
    createdAt: z.iso.datetime(),
    createdBy: z.string().min(1),
    id: z.string().min(1),
    projectId: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().positive(),
  })
  .strict();

export const toolCustomizationDetailSchema = toolCustomizationSummarySchema
  .extend({
    body: z.string().min(1),
  })
  .strict();

export const uploadToolCustomizationInputSchema = z
  .object({
    body: z.string().min(1).max(64_000),
    capabilityId: z.string().min(1),
    projectId: z.string().min(1),
  })
  .strict();

export const adminTelegramPairingLinkSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    pairingUrl: z.url(),
  })
  .strict();

export const adminTelegramTargetSchema = z
  .object({
    botId: z.string().regex(/^\d+$/),
    botUsername: z.string().min(1),
    chatId: z.string().regex(/^-?\d+$/),
    externalUserId: z.string().regex(/^\d+$/),
    pairedAt: z.iso.datetime(),
    status: z.literal('active'),
  })
  .strict()
  .nullable();

export const ADMIN_CLIENT_MESSAGE_MAX_LENGTH = 2000;

export const adminClientMessageInputSchema = z
  .object({
    message: z
      .string()
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, 'Message is required.')
          .max(
            ADMIN_CLIENT_MESSAGE_MAX_LENGTH,
            `Message must be at most ${String(ADMIN_CLIENT_MESSAGE_MAX_LENGTH)} characters.`,
          ),
      ),
  })
  .strict();

export const clientMessageTargetSchema = z
  .object({
    botUsername: z.string().min(1).nullable(),
    clientName: z.string().min(1),
    paired: z.boolean(),
    projectKey: z.string().min(1),
    tenantKey: z.string().min(1),
  })
  .strict();

export const adminClientMessageQueuedSchema = z
  .object({
    notificationType: z.enum([
      'admin.direct_message',
      'admin.request_message',
      'admin.ticket_message',
    ]),
    queued: z.literal(true),
  })
  .strict();

export const ticketStateSchema = z.enum([
  'new',
  'in_process',
  'declined',
  'closed',
]);

export const ticketPrioritySchema = z.enum(['low', 'medium', 'high']);

export const ticketTabSchema = z.enum(['pending', 'history', 'all']);

export const ticketListPageSizes = requestListPageSizes;

export const ticketListCursorSchema = requestListCursorSchema;

export const encodeTicketListCursor = encodeRequestListCursor;

export const decodeTicketListCursor = decodeRequestListCursor;

export const ticketActivitySchema = z
  .object({
    actorType: z.enum(['platform_owner', 'system', 'client']),
    createdAt: z.iso.datetime(),
    id: z.string().min(1),
    kind: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

export const ticketSummarySchema = z
  .object({
    category: z.string().min(1).nullable(),
    clientKey: z.string().min(1),
    clientName: z.string().min(1),
    createdAt: z.iso.datetime(),
    excerpt: z.string(),
    id: z.string().min(1),
    priority: ticketPrioritySchema.nullable(),
    projectId: z.string().min(1),
    publicId: z.string().min(1),
    readAt: z.iso.datetime().nullable(),
    revision: resourceVersionSchema,
    state: ticketStateSchema,
    title: z.string().min(1),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const ticketDetailSchema = ticketSummarySchema
  .extend({
    activity: z.array(ticketActivitySchema),
    adminNotes: z.string(),
    body: z.string(),
  })
  .strict();

export const ticketPageSchema = cursorPageSchema(ticketSummarySchema).extend({
  pendingCount: z.coerce.number().int().nonnegative(),
  totalCount: z.coerce.number().int().nonnegative(),
});

export const ticketListQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .refine(
        (value): value is (typeof ticketListPageSizes)[number] =>
          (ticketListPageSizes as readonly number[]).includes(value),
      )
      .default(10),
    projectId: z.string().min(1).optional(),
    state: ticketStateSchema.optional(),
    tab: ticketTabSchema.default('pending'),
  })
  .strict();

export const patchTicketInputSchema = z
  .object({
    adminNotes: z.string().max(20_000).optional(),
    state: ticketStateSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.state !== undefined || value.adminNotes !== undefined,
    { message: 'At least one of state or adminNotes is required.' },
  );

export const createTicketInputSchema = z
  .object({
    body: z.string().min(1).max(50_000),
    category: z.string().min(1).max(120).optional(),
    excerpt: z.string().max(500).optional(),
    priority: ticketPrioritySchema.optional(),
    projectId: z.string().min(1),
    tenantId: z.string().min(1),
    title: z.string().min(1).max(240),
  })
  .strict();

export type RequestState = z.infer<typeof requestStateSchema>;
export type RequestSummary = z.infer<typeof requestSummarySchema>;
export type RevisionMagnitude = z.infer<typeof revisionMagnitudeSchema>;
export type RevisionPlan = z.infer<typeof revisionPlanSchema>;
export type RevisionOperation = z.infer<typeof revisionOperationSchema>;
export interface RequestListQuery {
  cursor?: string;
  limit: (typeof requestListPageSizes)[number];
  needsAdminApproval?: boolean;
  projectId?: string;
}
export type RequestStage = z.infer<typeof requestStageSchema>;
export type RequestFailure = z.infer<typeof requestFailureSchema>;
export type RequestDetail = z.infer<typeof requestDetailSchema>;
export type LocalizedBlogArticle = z.infer<typeof localizedBlogArticleSchema>;
export type GeneratedBlogBundle = z.infer<typeof generatedBlogBundleSchema>;
export type TelegramIngress = z.infer<typeof telegramIngressSchema>;
export type TelegramReply = z.infer<typeof telegramReplySchema>;
export type WorkflowResumeSignal = z.infer<typeof workflowResumeSignalSchema>;
export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type GlobalProfileSummary = z.infer<typeof globalProfileSummarySchema>;
export type ProjectManifestResponse = z.infer<
  typeof projectManifestResponseSchema
>;
export type ToolCatalogItem = z.infer<typeof toolCatalogItemSchema>;
export type ToolCatalogResponse = z.infer<typeof toolCatalogResponseSchema>;
export type ToolGraphResponse = z.infer<typeof toolGraphResponseSchema>;
export type ToolCustomizationSummary = z.infer<
  typeof toolCustomizationSummarySchema
>;
export type ToolCustomizationDetail = z.infer<
  typeof toolCustomizationDetailSchema
>;
export type UploadToolCustomizationInput = z.infer<
  typeof uploadToolCustomizationInputSchema
>;
export type AdminClientMessageInput = z.infer<
  typeof adminClientMessageInputSchema
>;
export type ClientMessageTarget = z.infer<typeof clientMessageTargetSchema>;
export type AdminClientMessageQueued = z.infer<
  typeof adminClientMessageQueuedSchema
>;
export type TicketState = z.infer<typeof ticketStateSchema>;
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;
export type TicketTab = z.infer<typeof ticketTabSchema>;
export type TicketActivity = z.infer<typeof ticketActivitySchema>;
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketDetail = z.infer<typeof ticketDetailSchema>;
export type TicketPage = z.infer<typeof ticketPageSchema>;
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;
export type PatchTicketInput = z.infer<typeof patchTicketInputSchema>;
export type CreateTicketInput = z.infer<typeof createTicketInputSchema>;
export interface TicketListQueryInput {
  cursor?: string;
  limit: (typeof ticketListPageSizes)[number];
  projectId?: string;
  state?: TicketState;
  tab: TicketTab;
}
