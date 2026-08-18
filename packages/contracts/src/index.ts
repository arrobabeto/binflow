import { z } from 'zod';

export const supportedLocaleSchema = z.enum(['en', 'es', 'de']);
export const translationPolicySchema = z.enum([
  'always_translate',
  'ask_each_action',
]);
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
  repository: 'arrobabeto/webbin',
  tenantKey: 'webbin',
} as const;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;
export type TranslationPolicy = z.infer<typeof translationPolicySchema>;
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

export const enrollmentConfigurationSchema = z
  .object({
    clientContactEmail: z.email().optional(),
    clientConversationLocale: supportedLocaleSchema.optional(),
    contentLocales: z.array(supportedLocaleSchema).min(1).max(3).optional(),
    editorialAudience: z.string().min(1).max(2000).optional(),
    editorialVoice: z.string().min(1).max(2000).optional(),
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
export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentInputSchema>;
export type Enrollment = z.infer<typeof enrollmentSchema>;
export type EnrollmentValidationAttempt = z.infer<
  typeof enrollmentValidationAttemptSchema
>;
