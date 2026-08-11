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
  'revoked',
]);

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
export type HealthResponse = z.infer<typeof healthResponseSchema>;
