import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
  'revoked',
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
    index('projects_tenant_idx').on(table.tenantId),
    pgPolicy('projects_tenant_isolation', {
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
    projectId: text('project_id').references(() => projects.id),
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
    tenantId: text('tenant_id').references(() => tenants.id),
    projectId: text('project_id').references(() => projects.id),
    kind: text('kind').notNull(),
    alias: text('alias').notNull(),
    secretReferenceId: text('secret_reference_id')
      .notNull()
      .references(() => secretReferences.id),
    maskedSuffix: text('masked_suffix').notNull(),
    status: integrationStatus('status').notNull().default('unverified'),
    version: integer('version').notNull(),
    testedAt: timestamp('tested_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('provider_credentials_tenant_idx').on(table.tenantId),
    index('provider_credentials_project_idx').on(table.projectId),
    uniqueIndex('provider_credentials_scope_kind_version_unique').on(
      table.tenantId,
      table.projectId,
      table.kind,
      table.version,
    ),
    pgPolicy('provider_credentials_tenant_isolation', {
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
