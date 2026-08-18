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
export type ErrorCategory = z.infer<typeof errorCategorySchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type CursorQuery = z.infer<typeof cursorQuerySchema>;
export type AdminOperationStatus = z.infer<typeof adminOperationStatusSchema>;
export type AdminOperationReference = z.infer<
  typeof adminOperationReferenceSchema
>;
export type AdminOperation = z.infer<typeof adminOperationSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
