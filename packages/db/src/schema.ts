import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type {
  EnrollmentConfiguration,
  ProjectManifest,
  SupportedLocale,
  TranslationPolicy,
} from '@binflow/contracts';

export * from './auth-schema.js';

export const tenantStatus = pgEnum('tenant_status', [
  'draft',
  'active',
  'suspended',
  'archived',
]);
export const projectStatus = pgEnum('project_status', [
  'draft',
  'active',
  'suspended',
  'archived',
]);
export const integrationStatus = pgEnum('integration_status', [
  'unverified',
  'active',
  'invalid',
  'superseded',
  'revoked',
]);
export const credentialOwnerScope = pgEnum('credential_owner_scope', [
  'platform',
  'tenant',
  'project',
]);
export const idempotencyStatus = pgEnum('idempotency_status', [
  'processing',
  'completed',
  'failed',
]);
export const adminOperationStatus = pgEnum('admin_operation_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export const outboxStatus = pgEnum('outbox_status', [
  'pending',
  'published',
  'failed',
]);
export const enrollmentState = pgEnum('enrollment_state', [
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
export const enrollmentValidationResult = pgEnum(
  'enrollment_validation_result',
  ['success', 'failed', 'blocked'],
);
export const projectManifestStatus = pgEnum('project_manifest_status', [
  'draft',
  'validated',
  'active',
  'superseded',
]);

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    status: tenantStatus('status').notNull().default('draft'),
    timezone: text('timezone').notNull().default('UTC'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tenants_key_unique').on(table.key),
    pgPolicy('tenants_tenant_isolation', {
      for: 'all',
      using: sql`${table.id} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.id} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    profile: text('profile').notNull().default('astro_repo'),
    status: projectStatus('status').notNull().default('draft'),
    activeManifestVersion: integer('active_manifest_version'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_tenant_key_unique').on(table.tenantId, table.key),
    check(
      'projects_active_manifest_version_check',
      sql`${table.activeManifestVersion} IS NULL OR ${table.activeManifestVersion} >= 1`,
    ),
    uniqueIndex('projects_id_tenant_unique').on(table.id, table.tenantId),
    index('projects_tenant_idx').on(table.tenantId),
    pgPolicy('projects_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const projectManifestVersions = pgTable(
  'project_manifest_versions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: text('project_id').notNull(),
    version: integer('version').notNull(),
    status: projectManifestStatus('status').notNull(),
    profile: text('profile').notNull(),
    globalProfileVersion: text('global_profile_version').notNull(),
    dependencyFingerprint: text('dependency_fingerprint').notNull(),
    document: jsonb('document').$type<ProjectManifest>().notNull(),
    createdBy: text('created_by').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }).notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'project_manifest_versions_version_check',
      sql`${table.version} >= 1`,
    ),
    uniqueIndex('project_manifest_versions_project_version_unique').on(
      table.projectId,
      table.version,
    ),
    unique('project_manifest_versions_id_scope_unique').on(
      table.id,
      table.tenantId,
      table.projectId,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'project_manifest_versions_project_tenant_fk',
    }),
    index('project_manifest_versions_project_idx').on(
      table.projectId,
      table.version,
    ),
    pgPolicy('project_manifest_versions_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const projectLocales = pgTable(
  'project_locales',
  {
    id: text('id').primaryKey(),
    manifestVersionId: text('manifest_version_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    conversationLocale: text('conversation_locale')
      .$type<SupportedLocale>()
      .notNull(),
    contentLocales: jsonb('content_locales')
      .$type<SupportedLocale[]>()
      .notNull(),
    defaultContentLocale: text('default_content_locale')
      .$type<SupportedLocale>()
      .notNull(),
    requiredContentLocales: jsonb('required_content_locales')
      .$type<SupportedLocale[]>()
      .notNull(),
    slugLocale: text('slug_locale').$type<SupportedLocale>().notNull(),
    translationPolicy: text('translation_policy')
      .$type<TranslationPolicy>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_locales_manifest_unique').on(table.manifestVersionId),
    foreignKey({
      columns: [table.manifestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        projectManifestVersions.id,
        projectManifestVersions.tenantId,
        projectManifestVersions.projectId,
      ],
      name: 'project_locales_manifest_scope_fk',
    }),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'project_locales_project_tenant_fk',
    }),
    pgPolicy('project_locales_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const projectBudgetPolicies = pgTable(
  'project_budget_policies',
  {
    id: text('id').primaryKey(),
    manifestVersionId: text('manifest_version_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    maxRequestsPerDay: integer('max_requests_per_day').notNull(),
    maxModelCallsPerRequest: integer('max_model_calls_per_request').notNull(),
    maxTokensPerRequest: integer('max_tokens_per_request').notNull(),
    maxEstimatedCostCentsPerRequest: integer(
      'max_estimated_cost_cents_per_request',
    ).notNull(),
    maxEstimatedCostCentsPerDay: integer(
      'max_estimated_cost_cents_per_day',
    ).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'project_budget_policies_positive_check',
      sql`${table.maxRequestsPerDay} >= 1 AND ${table.maxModelCallsPerRequest} >= 1 AND ${table.maxTokensPerRequest} >= 1000 AND ${table.maxEstimatedCostCentsPerRequest} >= 1 AND ${table.maxEstimatedCostCentsPerDay} >= ${table.maxEstimatedCostCentsPerRequest}`,
    ),
    uniqueIndex('project_budget_policies_manifest_unique').on(
      table.manifestVersionId,
    ),
    foreignKey({
      columns: [table.manifestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        projectManifestVersions.id,
        projectManifestVersions.tenantId,
        projectManifestVersions.projectId,
      ],
      name: 'project_budget_policies_manifest_scope_fk',
    }),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'project_budget_policies_project_tenant_fk',
    }),
    pgPolicy('project_budget_policies_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const capabilityDefinitions = pgTable(
  'capability_definitions',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    command: text('command').notNull(),
    displayName: text('display_name').notNull(),
    executorId: text('executor_id').notNull(),
    inputSchemaId: text('input_schema_id').notNull(),
    outputSchemaId: text('output_schema_id').notNull(),
    allowedProfiles: jsonb('allowed_profiles').$type<string[]>().notNull(),
    riskClass: text('risk_class').notNull(),
    requiredPermissions: jsonb('required_permissions')
      .$type<string[]>()
      .notNull(),
    requiresPreview: boolean('requires_preview').notNull(),
    approvalPolicyId: text('approval_policy_id').notNull(),
    timeoutSeconds: integer('timeout_seconds').notNull(),
    retryPolicy: jsonb('retry_policy').notNull(),
    budgetPolicy: jsonb('budget_policy').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('capability_definitions_id_version_unique').on(
      table.id,
      table.version,
    ),
    check('capability_definitions_version_check', sql`${table.version} >= 1`),
    check(
      'capability_definitions_timeout_check',
      sql`${table.timeoutSeconds} >= 1`,
    ),
  ],
);

export const projectCapabilityBindings = pgTable(
  'project_capability_bindings',
  {
    id: text('id').primaryKey(),
    manifestVersionId: text('manifest_version_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    capabilityVersion: integer('capability_version').notNull(),
    access: text('access').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_capability_bindings_manifest_capability_unique').on(
      table.manifestVersionId,
      table.capabilityId,
    ),
    foreignKey({
      columns: [table.capabilityId, table.capabilityVersion],
      foreignColumns: [capabilityDefinitions.id, capabilityDefinitions.version],
      name: 'project_capability_bindings_definition_fk',
    }),
    foreignKey({
      columns: [table.manifestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        projectManifestVersions.id,
        projectManifestVersions.tenantId,
        projectManifestVersions.projectId,
      ],
      name: 'project_capability_bindings_manifest_scope_fk',
    }),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'project_capability_bindings_project_tenant_fk',
    }),
    pgPolicy('project_capability_bindings_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const clientEnrollments = pgTable(
  'client_enrollments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    projectId: text('project_id').notNull(),
    state: enrollmentState('state').notNull().default('draft'),
    currentStep: integer('current_step').notNull().default(1),
    configuration: jsonb('configuration')
      .$type<EnrollmentConfiguration>()
      .notNull()
      .default({}),
    version: integer('version').notNull().default(1),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'client_enrollments_current_step_check',
      sql`${table.currentStep} >= 1 AND ${table.currentStep} <= 11`,
    ),
    check('client_enrollments_version_check', sql`${table.version} >= 1`),
    uniqueIndex('client_enrollments_tenant_unique').on(table.tenantId),
    uniqueIndex('client_enrollments_project_unique').on(table.projectId),
    unique('client_enrollments_id_scope_unique').on(
      table.id,
      table.tenantId,
      table.projectId,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'client_enrollments_project_tenant_fk',
    }),
    pgPolicy('client_enrollments_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const enrollmentValidationAttempts = pgTable(
  'enrollment_validation_attempts',
  {
    id: text('id').primaryKey(),
    enrollmentId: text('enrollment_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    checkName: text('check_name').notNull(),
    checkVersion: integer('check_version').notNull(),
    dependencyFingerprint: text('dependency_fingerprint').notNull(),
    result: enrollmentValidationResult('result').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    errorCategory: text('error_category'),
    errorCode: text('error_code'),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'enrollment_validation_attempts_check_version_check',
      sql`${table.checkVersion} >= 1`,
    ),
    index('enrollment_validation_attempts_enrollment_idx').on(
      table.enrollmentId,
      table.checkedAt,
    ),
    foreignKey({
      columns: [table.enrollmentId, table.tenantId, table.projectId],
      foreignColumns: [
        clientEnrollments.id,
        clientEnrollments.tenantId,
        clientEnrollments.projectId,
      ],
      name: 'enrollment_validation_attempts_enrollment_scope_fk',
    }),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'enrollment_validation_attempts_project_tenant_fk',
    }),
    pgPolicy('enrollment_validation_attempts_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const pairingTokens = pgTable(
  'pairing_tokens',
  {
    id: text('id').primaryKey(),
    enrollmentId: text('enrollment_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: text('created_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pairing_tokens_hash_unique').on(table.tokenHash),
    index('pairing_tokens_enrollment_idx').on(table.enrollmentId),
    foreignKey({
      columns: [table.enrollmentId, table.tenantId, table.projectId],
      foreignColumns: [
        clientEnrollments.id,
        clientEnrollments.tenantId,
        clientEnrollments.projectId,
      ],
      name: 'pairing_tokens_enrollment_scope_fk',
    }),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'pairing_tokens_project_tenant_fk',
    }),
    pgPolicy('pairing_tokens_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const secretReferences = pgTable(
  'secret_references',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    provider: text('provider').notNull(),
    credentialVersion: integer('credential_version').notNull(),
    keyVersion: integer('key_version').notNull(),
    algorithm: text('algorithm').notNull(),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    authTag: text('auth_tag').notNull(),
    wrappedDek: text('wrapped_dek').notNull(),
    wrapNonce: text('wrap_nonce').notNull(),
    wrapAuthTag: text('wrap_auth_tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('secret_references_tenant_idx').on(table.tenantId),
    index('secret_references_project_idx').on(table.projectId),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'secret_references_project_tenant_fk',
    }),
    pgPolicy('secret_references_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: text('id').primaryKey(),
    ownerScope: credentialOwnerScope('owner_scope').notNull(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    kind: text('kind').notNull(),
    alias: text('alias').notNull(),
    configuration: jsonb('configuration').notNull().default({}),
    externalResourceId: text('external_resource_id'),
    verificationEvidence: jsonb('verification_evidence').notNull().default({}),
    secretReferenceId: text('secret_reference_id')
      .notNull()
      .references(() => secretReferences.id),
    maskedSuffix: text('masked_suffix').notNull(),
    status: integrationStatus('status').notNull().default('unverified'),
    version: integer('version').notNull(),
    revision: integer('revision').notNull().default(1),
    testedAt: timestamp('tested_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'provider_credentials_owner_scope_check',
      sql`(${table.ownerScope} = 'platform' AND ${table.tenantId} IS NULL AND ${table.projectId} IS NULL) OR (${table.ownerScope} = 'tenant' AND ${table.tenantId} IS NOT NULL AND ${table.projectId} IS NULL) OR (${table.ownerScope} = 'project' AND ${table.tenantId} IS NOT NULL AND ${table.projectId} IS NOT NULL)`,
    ),
    check('provider_credentials_revision_check', sql`${table.revision} >= 1`),
    index('provider_credentials_tenant_idx').on(table.tenantId),
    index('provider_credentials_project_idx').on(table.projectId),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'provider_credentials_project_tenant_fk',
    }),
    uniqueIndex('provider_credentials_scope_kind_version_unique').on(
      table.ownerScope,
      sql`coalesce(${table.tenantId}, 'platform')`,
      sql`coalesce(${table.projectId}, 'platform')`,
      table.kind,
      table.version,
    ),
    uniqueIndex('provider_credentials_one_active_per_scope_unique')
      .on(
        table.ownerScope,
        sql`coalesce(${table.tenantId}, 'platform')`,
        sql`coalesce(${table.projectId}, 'platform')`,
        table.kind,
      )
      .where(sql`${table.status} = 'active'`),
    uniqueIndex('provider_credentials_active_telegram_bot_unique')
      .on(table.externalResourceId)
      .where(
        sql`${table.status} = 'active' AND ${table.kind} IN ('telegram-admin', 'telegram-client') AND ${table.externalResourceId} IS NOT NULL`,
      ),
    pgPolicy('provider_credentials_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    credentialId: text('credential_id')
      .notNull()
      .references(() => providerCredentials.id),
    kind: text('kind').notNull(),
    externalResourceId: text('external_resource_id'),
    configuration: jsonb('configuration').notNull().default({}),
    verificationEvidence: jsonb('verification_evidence').notNull().default({}),
    status: integrationStatus('status').notNull().default('unverified'),
    testedAt: timestamp('tested_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('integration_connections_tenant_idx').on(table.tenantId),
    index('integration_connections_project_idx').on(table.projectId),
    index('integration_connections_credential_idx').on(table.credentialId),
    uniqueIndex('integration_connections_credential_unique').on(
      table.credentialId,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'integration_connections_project_tenant_fk',
    }),
    uniqueIndex('integration_connections_project_kind_credential_unique').on(
      table.tenantId,
      table.projectId,
      table.kind,
      table.credentialId,
    ),
    pgPolicy('integration_connections_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const credentialEvents = pgTable(
  'credential_events',
  {
    id: text('id').primaryKey(),
    credentialId: text('credential_id')
      .notNull()
      .references(() => providerCredentials.id),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id').references(() => projects.id),
    action: text('action').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('credential_events_credential_idx').on(table.credentialId),
    pgPolicy('credential_events_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default({}),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_events_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    index('audit_events_correlation_idx').on(table.correlationId),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'audit_events_project_tenant_fk',
    }),
    pgPolicy('audit_events_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const adminOperations = pgTable(
  'admin_operations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    actorId: text('actor_id').notNull(),
    type: text('type').notNull(),
    status: adminOperationStatus('status').notNull().default('pending'),
    progress: integer('progress').notNull().default(0),
    inputHash: text('input_hash').notNull(),
    result: jsonb('result'),
    errorCategory: text('error_category'),
    errorCode: text('error_code'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'admin_operations_progress_check',
      sql`${table.progress} >= 0 AND ${table.progress} <= 100`,
    ),
    index('admin_operations_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'admin_operations_project_tenant_fk',
    }),
    pgPolicy('admin_operations_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    actorId: text('actor_id').notNull(),
    method: text('method').notNull(),
    route: text('route').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatus('status').notNull().default('processing'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    operationId: text('operation_id').references(() => adminOperations.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idempotency_records_actor_route_key_unique').on(
      table.actorId,
      table.method,
      table.route,
      table.idempotencyKey,
    ),
    index('idempotency_records_expiry_idx').on(table.expiresAt),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'idempotency_records_project_tenant_fk',
    }),
    pgPolicy('idempotency_records_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    jobKey: text('job_key').notNull(),
    status: outboxStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastErrorCategory: text('last_error_category'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('outbox_events_job_key_unique').on(table.jobKey),
    index('outbox_events_delivery_idx').on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'outbox_events_project_tenant_fk',
    }),
    pgPolicy('outbox_events_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const processedEvents = pgTable(
  'processed_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id'),
    consumer: text('consumer').notNull(),
    eventKey: text('event_key').notNull(),
    result: jsonb('result').notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('processed_events_consumer_key_unique').on(
      table.consumer,
      table.eventKey,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'processed_events_project_tenant_fk',
    }),
    pgPolicy('processed_events_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();
