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
  CapabilityInput,
  CreateBlogDraftInput,
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
export const requestState = pgEnum('request_state', [
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
export const workflowRunStatus = pgEnum('workflow_run_status', [
  'waiting',
  'queued',
  'running',
  'interrupted',
  'completed',
  'failed',
  'cancelled',
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

export const clientUsers = pgTable(
  'client_users',
  {
    id: text('id').primaryKey(),
    enrollmentId: text('enrollment_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    contactEmail: text('contact_email'),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('pending_pairing'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('client_users_enrollment_unique').on(table.enrollmentId),
    unique('client_users_id_scope_unique').on(
      table.id,
      table.tenantId,
      table.projectId,
    ),
    foreignKey({
      columns: [table.enrollmentId, table.tenantId, table.projectId],
      foreignColumns: [
        clientEnrollments.id,
        clientEnrollments.tenantId,
        clientEnrollments.projectId,
      ],
      name: 'client_users_enrollment_scope_fk',
    }),
    pgPolicy('client_users_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    role: text('role').notNull().default('client'),
    status: text('status').notNull().default('pending_pairing'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_user_project_unique').on(
      table.userId,
      table.projectId,
    ),
    foreignKey({
      columns: [table.userId, table.tenantId, table.projectId],
      foreignColumns: [
        clientUsers.id,
        clientUsers.tenantId,
        clientUsers.projectId,
      ],
      name: 'memberships_user_scope_fk',
    }),
    pgPolicy('memberships_tenant_isolation', {
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
    userId: text('user_id'),
    botCredentialId: text('bot_credential_id'),
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
    foreignKey({
      columns: [table.userId, table.tenantId, table.projectId],
      foreignColumns: [
        clientUsers.id,
        clientUsers.tenantId,
        clientUsers.projectId,
      ],
      name: 'pairing_tokens_user_scope_fk',
    }),
    pgPolicy('pairing_tokens_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const adminPairingTokens = pgTable(
  'admin_pairing_tokens',
  {
    id: text('id').primaryKey(),
    botCredentialId: text('bot_credential_id')
      .notNull()
      .references(() => providerCredentials.id),
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
    uniqueIndex('admin_pairing_tokens_hash_unique').on(table.tokenHash),
    index('admin_pairing_tokens_bot_idx').on(table.botCredentialId),
  ],
);

export const adminNotificationTargets = pgTable(
  'admin_notification_targets',
  {
    id: text('id').primaryKey(),
    botCredentialId: text('bot_credential_id')
      .notNull()
      .references(() => providerCredentials.id),
    botId: text('bot_id').notNull(),
    externalUserId: text('external_user_id').notNull(),
    chatId: text('chat_id').notNull(),
    status: text('status').notNull().default('active'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_notification_targets_bot_unique').on(
      table.botCredentialId,
    ),
    uniqueIndex('admin_notification_targets_identity_unique').on(
      table.botId,
      table.externalUserId,
    ),
  ],
);

export const serviceHeartbeats = pgTable('service_heartbeats', {
  service: text('service').primaryKey(),
  instanceId: text('instance_id').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

export const channelIdentities = pgTable(
  'channel_identities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    botCredentialId: text('bot_credential_id')
      .notNull()
      .references(() => providerCredentials.id),
    botId: text('bot_id').notNull(),
    provider: text('provider').notNull().default('telegram'),
    externalUserId: text('external_user_id').notNull(),
    chatId: text('chat_id').notNull(),
    status: text('status').notNull().default('active'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('channel_identities_bot_user_unique').on(
      table.botId,
      table.externalUserId,
    ),
    uniqueIndex('channel_identities_user_provider_unique').on(
      table.userId,
      table.provider,
    ),
    foreignKey({
      columns: [table.userId, table.tenantId, table.projectId],
      foreignColumns: [
        clientUsers.id,
        clientUsers.tenantId,
        clientUsers.projectId,
      ],
      name: 'channel_identities_user_scope_fk',
    }),
    pgPolicy('channel_identities_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    channelIdentityId: text('channel_identity_id')
      .notNull()
      .references(() => channelIdentities.id),
    externalChatId: text('external_chat_id').notNull(),
    locale: text('locale').$type<SupportedLocale>().notNull(),
    status: text('status').notNull().default('active'),
    lastMessageAt: timestamp('last_message_at', {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('conversations_identity_chat_unique').on(
      table.channelIdentityId,
      table.externalChatId,
    ),
    foreignKey({
      columns: [table.userId, table.tenantId, table.projectId],
      foreignColumns: [
        clientUsers.id,
        clientUsers.tenantId,
        clientUsers.projectId,
      ],
      name: 'conversations_user_scope_fk',
    }),
    pgPolicy('conversations_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const channelMessages = pgTable(
  'channel_messages',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    botId: text('bot_id').notNull(),
    externalUpdateId: text('external_update_id').notNull(),
    direction: text('direction').notNull(),
    kind: text('kind').notNull(),
    contentDigest: text('content_digest').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('channel_messages_bot_update_unique').on(
      table.botId,
      table.externalUpdateId,
    ),
    pgPolicy('channel_messages_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const requests = pgTable(
  'requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    capabilityId: text('capability_id').notNull(),
    state: requestState('state').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    topic: text('topic'),
    terminalResult: jsonb('terminal_result'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('requests_version_check', sql`${table.version} >= 1`),
    check('requests_current_version_check', sql`${table.currentVersion} >= 1`),
    unique('requests_id_scope_unique').on(
      table.id,
      table.tenantId,
      table.projectId,
    ),
    index('requests_project_updated_idx').on(table.projectId, table.updatedAt),
    foreignKey({
      columns: [table.userId, table.tenantId, table.projectId],
      foreignColumns: [
        clientUsers.id,
        clientUsers.tenantId,
        clientUsers.projectId,
      ],
      name: 'requests_user_scope_fk',
    }),
    pgPolicy('requests_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const requestVersions = pgTable(
  'request_versions',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    version: integer('version').notNull(),
    manifestVersionId: text('manifest_version_id').notNull(),
    capabilityVersion: integer('capability_version').notNull(),
    interpretedInput: jsonb('interpreted_input')
      .$type<CapabilityInput>()
      .notNull(),
    plan: jsonb('plan').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    supersededById: text('superseded_by_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('request_versions_request_version_unique').on(
      table.requestId,
      table.version,
    ),
    unique('request_versions_id_scope_unique').on(
      table.id,
      table.tenantId,
      table.projectId,
    ),
    foreignKey({
      columns: [table.requestId, table.tenantId, table.projectId],
      foreignColumns: [requests.id, requests.tenantId, requests.projectId],
      name: 'request_versions_request_scope_fk',
    }),
    pgPolicy('request_versions_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const requestActions = pgTable(
  'request_actions',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    action: text('action').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('request_actions_token_hash_unique').on(table.tokenHash),
    index('request_actions_request_idx').on(table.requestId),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'request_actions_version_scope_fk',
    }),
    pgPolicy('request_actions_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const graphRuns = pgTable(
  'graph_runs',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    graphVersion: text('graph_version').notNull(),
    status: workflowRunStatus('status').notNull(),
    currentNode: text('current_node').notNull(),
    checkpointSequence: integer('checkpoint_sequence').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('graph_runs_request_version_unique').on(table.requestVersionId),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'graph_runs_version_scope_fk',
    }),
    pgPolicy('graph_runs_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const workflowCheckpoints = pgTable(
  'workflow_checkpoints',
  {
    id: text('id').primaryKey(),
    graphRunId: text('graph_run_id')
      .notNull()
      .references(() => graphRuns.id),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    sequence: integer('sequence').notNull(),
    node: text('node').notNull(),
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('workflow_checkpoints_sequence_check', sql`${table.sequence} >= 1`),
    uniqueIndex('workflow_checkpoints_run_sequence_unique').on(
      table.graphRunId,
      table.sequence,
    ),
    pgPolicy('workflow_checkpoints_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const contentCatalogSyncs = pgTable(
  'content_catalog_syncs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    sourceRevision: text('source_revision').notNull(),
    itemCount: integer('item_count').notNull(),
    status: text('status').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('content_catalog_syncs_project_revision_unique').on(
      table.projectId,
      table.sourceRevision,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'content_catalog_syncs_project_tenant_fk',
    }),
    pgPolicy('content_catalog_syncs_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const contentCatalogItems = pgTable(
  'content_catalog_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    syncId: text('sync_id')
      .notNull()
      .references(() => contentCatalogSyncs.id),
    sourceId: text('source_id').notNull(),
    sourceRevision: text('source_revision').notNull(),
    locale: text('locale').$type<SupportedLocale>().notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    category: text('category').notNull(),
    contentHash: text('content_hash').notNull(),
    embedding: jsonb('embedding').$type<number[]>(),
    status: text('status').notNull().default('published'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('content_catalog_items_project_source_locale_unique').on(
      table.projectId,
      table.sourceId,
      table.locale,
    ),
    index('content_catalog_items_project_slug_idx').on(
      table.projectId,
      table.slug,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'content_catalog_items_project_tenant_fk',
    }),
    pgPolicy('content_catalog_items_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const similarityChecks = pgTable(
  'similarity_checks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    catalogSyncId: text('catalog_sync_id')
      .notNull()
      .references(() => contentCatalogSyncs.id),
    intentHash: text('intent_hash').notNull(),
    level: text('level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('similarity_checks_request_version_unique').on(
      table.requestVersionId,
    ),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'similarity_checks_request_version_scope_fk',
    }),
    pgPolicy('similarity_checks_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const candidateMatches = pgTable(
  'candidate_matches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    similarityCheckId: text('similarity_check_id')
      .notNull()
      .references(() => similarityChecks.id),
    sourceId: text('source_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    scoreBasisPoints: integer('score_basis_points').notNull(),
    rank: integer('rank').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('candidate_matches_check_rank_unique').on(
      table.similarityCheckId,
      table.rank,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'candidate_matches_project_tenant_fk',
    }),
    check(
      'candidate_matches_score_range',
      sql`${table.scoreBasisPoints} >= -10000 AND ${table.scoreBasisPoints} <= 10000`,
    ),
    check('candidate_matches_rank_positive', sql`${table.rank} > 0`),
    pgPolicy('candidate_matches_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    kind: text('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').notNull().default('active'),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('artifacts_storage_key_unique').on(table.storageKey),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'artifacts_request_version_scope_fk',
    }),
    pgPolicy('artifacts_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const repoChanges = pgTable(
  'repo_changes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    baseSha: text('base_sha').notNull(),
    headSha: text('head_sha').notNull(),
    branch: text('branch').notNull(),
    files: jsonb('files').$type<string[]>().notNull(),
    artifactHashes: jsonb('artifact_hashes')
      .$type<Record<string, string>>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('repo_changes_request_version_unique').on(
      table.requestVersionId,
    ),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'repo_changes_request_version_scope_fk',
    }),
    pgPolicy('repo_changes_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const pullRequests = pgTable(
  'pull_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    repoChangeId: text('repo_change_id')
      .notNull()
      .references(() => repoChanges.id),
    providerId: text('provider_id').notNull(),
    url: text('url').notNull(),
    baseSha: text('base_sha').notNull(),
    headSha: text('head_sha').notNull(),
    state: text('state').notNull(),
    mergeCommitSha: text('merge_commit_sha'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pull_requests_request_version_unique').on(
      table.requestVersionId,
    ),
    uniqueIndex('pull_requests_provider_id_unique').on(table.providerId),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'pull_requests_request_version_scope_fk',
    }),
    pgPolicy('pull_requests_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const deployments = pgTable(
  'deployments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    providerId: text('provider_id').notNull(),
    environment: text('environment').notNull(),
    commitSha: text('commit_sha').notNull(),
    state: text('state').notNull(),
    urls: jsonb('urls').$type<Record<string, string>>().notNull(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('deployments_provider_id_environment_unique').on(
      table.providerId,
      table.environment,
    ),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'deployments_request_version_scope_fk',
    }),
    pgPolicy('deployments_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const approvals = pgTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    role: text('role').notNull(),
    decision: text('decision').notNull(),
    artifactId: text('artifact_id').notNull(),
    headCommitSha: text('head_commit_sha').notNull(),
    deploymentId: text('deployment_id').notNull(),
    approverId: text('approver_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('approvals_version_role_unique').on(
      table.requestVersionId,
      table.role,
    ),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'approvals_request_version_scope_fk',
    }),
    pgPolicy('approvals_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const publicationAttempts = pgTable(
  'publication_attempts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    preconditions: jsonb('preconditions').notNull(),
    status: text('status').notNull(),
    mergeCommitSha: text('merge_commit_sha'),
    result: jsonb('result').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'publication_attempts_request_version_scope_fk',
    }),
    pgPolicy('publication_attempts_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const modelCalls = pgTable(
  'model_calls',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    node: text('node').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputHash: text('input_hash').notNull(),
    outputArtifactId: text('output_artifact_id'),
    providerRequestId: text('provider_request_id'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'model_calls_request_version_scope_fk',
    }),
    pgPolicy('model_calls_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();

export const usageRecords = pgTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    requestId: text('request_id').notNull(),
    requestVersionId: text('request_version_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    modelCalls: integer('model_calls').notNull(),
    tokens: integer('tokens').notNull(),
    estimatedCostCents: integer('estimated_cost_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('usage_records_request_version_unique').on(
      table.requestVersionId,
    ),
    foreignKey({
      columns: [table.requestVersionId, table.tenantId, table.projectId],
      foreignColumns: [
        requestVersions.id,
        requestVersions.tenantId,
        requestVersions.projectId,
      ],
      name: 'usage_records_request_version_scope_fk',
    }),
    pgPolicy('usage_records_tenant_isolation', {
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

export const projectToolCustomizations = pgTable(
  'project_tool_customizations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    projectId: text('project_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('project_tool_customizations_project_capability_version').on(
      table.projectId,
      table.capabilityId,
      table.version,
    ),
    foreignKey({
      columns: [table.projectId, table.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: 'project_tool_customizations_project_tenant_fk',
    }),
    check(
      'project_tool_customizations_version_positive',
      sql`${table.version} > 0`,
    ),
    pgPolicy('project_tool_customizations_tenant_isolation', {
      for: 'all',
      using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
      withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true'`,
    }),
  ],
).enableRLS();
