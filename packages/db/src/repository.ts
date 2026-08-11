import { and, asc, desc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type {
  CredentialOwnerScope,
  IntegrationKind,
  IntegrationStatus,
} from '@binflow/contracts';
import { webbinPilotBinding } from '@binflow/contracts';
import { DomainError, type ErrorCategory } from '@binflow/domain';
import type { EncryptedSecretEnvelope } from '@binflow/secrets';

import type { Database } from './client.js';
import {
  credentialEvents,
  integrationConnections,
  projects,
  providerCredentials,
  secretReferences,
  tenants,
} from './schema.js';

export type ResolvedScope = Readonly<{
  tenantId?: string;
  projectId?: string;
}>;

export type SafeConfiguration = Readonly<Record<string, unknown>>;

export type CredentialForVerification = Readonly<{
  configuration: SafeConfiguration;
  connection?: Readonly<{
    configuration: SafeConfiguration;
    id: string;
    projectId?: string;
    tenantId?: string;
  }>;
  envelope: EncryptedSecretEnvelope;
  id: string;
  kind: IntegrationKind;
  ownerScope: CredentialOwnerScope;
  projectId?: string;
  secretContext: Readonly<{
    credentialId: string;
    keyVersion: number;
    provider: string;
    tenantId: string;
  }>;
  status: IntegrationStatus;
  tenantId?: string;
  version: number;
}>;

const asConfiguration = (value: unknown): SafeConfiguration =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as SafeConfiguration)
    : {};

const scopeConditions = (
  input: Readonly<{
    kind: string;
    ownerScope: CredentialOwnerScope;
    projectId: string | null | undefined;
    tenantId: string | null | undefined;
  }>,
) => [
  eq(providerCredentials.ownerScope, input.ownerScope),
  input.tenantId == null
    ? isNull(providerCredentials.tenantId)
    : eq(providerCredentials.tenantId, input.tenantId),
  input.projectId == null
    ? isNull(providerCredentials.projectId)
    : eq(providerCredentials.projectId, input.projectId),
  eq(providerCredentials.kind, input.kind),
];

const ownershipLockKey = (
  input: Readonly<{
    kind: string;
    ownerScope: CredentialOwnerScope;
    projectId: string | null | undefined;
    tenantId: string | null | undefined;
  }>,
): string =>
  [
    input.ownerScope,
    input.tenantId ?? 'platform',
    input.projectId ?? 'platform',
    input.kind,
  ].join(':');

const auditScope = async (
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  credentialId: string,
  fallback: Readonly<{
    projectId: string | null;
    tenantId: string | null;
  }>,
): Promise<Readonly<{ projectId: string | null; tenantId: string | null }>> => {
  const connection = await tx.query.integrationConnections.findFirst({
    where: eq(integrationConnections.credentialId, credentialId),
  });
  return {
    projectId: connection?.projectId ?? fallback.projectId,
    tenantId: connection?.tenantId ?? fallback.tenantId,
  };
};

const assertOwnerScope = (
  ownerScope: CredentialOwnerScope,
  scope: ResolvedScope,
): void => {
  const valid =
    (ownerScope === 'platform' &&
      scope.tenantId === undefined &&
      scope.projectId === undefined) ||
    (ownerScope === 'tenant' &&
      scope.tenantId !== undefined &&
      scope.projectId === undefined) ||
    (ownerScope === 'project' &&
      scope.tenantId !== undefined &&
      scope.projectId !== undefined);
  if (!valid) {
    throw new Error(`Invalid ${ownerScope} credential ownership scope.`);
  }
};

export const ensureDraftScope = async (
  db: Database,
  input: Readonly<{
    tenantKey: string;
    projectKey: string;
    tenantDisplayName?: string;
    projectDisplayName?: string;
  }>,
): Promise<Required<ResolvedScope>> => {
  const existingTenant = await db.query.tenants.findFirst({
    where: eq(tenants.key, input.tenantKey),
  });
  const tenantId = existingTenant?.id ?? uuidv7();
  if (existingTenant === undefined) {
    await db.insert(tenants).values({
      displayName: input.tenantDisplayName ?? input.tenantKey,
      id: tenantId,
      key: input.tenantKey,
    });
  }

  const existingProject = await db.query.projects.findFirst({
    where: and(
      eq(projects.tenantId, tenantId),
      eq(projects.key, input.projectKey),
    ),
  });
  const projectId = existingProject?.id ?? uuidv7();
  if (existingProject === undefined) {
    await db.insert(projects).values({
      displayName: input.projectDisplayName ?? input.projectKey,
      id: projectId,
      key: input.projectKey,
      tenantId,
    });
  }

  return { projectId, tenantId };
};

export const resolveScope = async (
  db: Database,
  input: Readonly<{ tenantKey?: string; projectKey?: string }>,
): Promise<ResolvedScope> => {
  if (input.projectKey !== undefined) {
    if (input.tenantKey === undefined) {
      throw new Error('Project scope requires a tenant key.');
    }
    const [project] = await db
      .select({ id: projects.id, tenantId: projects.tenantId })
      .from(projects)
      .innerJoin(tenants, eq(tenants.id, projects.tenantId))
      .where(
        and(
          eq(projects.key, input.projectKey),
          eq(tenants.key, input.tenantKey),
        ),
      )
      .limit(1);
    if (project === undefined) {
      throw new Error(
        `Unknown project scope: ${input.tenantKey}/${input.projectKey}`,
      );
    }
    return { projectId: project.id, tenantId: project.tenantId };
  }
  if (input.tenantKey !== undefined) {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.key, input.tenantKey),
    });
    if (tenant === undefined) {
      throw new Error(`Unknown tenant scope: ${input.tenantKey}`);
    }
    return { tenantId: tenant.id };
  }
  return {};
};

export const storeCredentialVersion = async (
  db: Database,
  input: Readonly<{
    alias: string;
    configuration: SafeConfiguration;
    connection?: Readonly<{
      configuration: SafeConfiguration;
      kind: IntegrationKind;
      scope: Required<ResolvedScope>;
    }>;
    credentialId: string;
    envelope: EncryptedSecretEnvelope;
    kind: IntegrationKind;
    maskedSuffix: string;
    ownerScope: CredentialOwnerScope;
    scope: ResolvedScope;
  }>,
): Promise<string> => {
  assertOwnerScope(input.ownerScope, input.scope);
  return db.transaction(async (tx) => {
    const ownershipKey = ownershipLockKey({
      kind: input.kind,
      ownerScope: input.ownerScope,
      projectId: input.scope.projectId,
      tenantId: input.scope.tenantId,
    });
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${ownershipKey}))`,
    );
    if (input.connection !== undefined) {
      if (input.connection.kind !== input.kind) {
        throw new DomainError(
          'policy_denied',
          'Integration connection kind does not match its credential.',
        );
      }
      if (
        input.ownerScope === 'project' &&
        (input.scope.tenantId !== input.connection.scope.tenantId ||
          input.scope.projectId !== input.connection.scope.projectId)
      ) {
        throw new DomainError(
          'policy_denied',
          'Project-owned credential scope must match its connection scope.',
        );
      }
      const [boundProject] = await tx
        .select({
          id: projects.id,
          projectKey: projects.key,
          tenantKey: tenants.key,
        })
        .from(projects)
        .innerJoin(tenants, eq(tenants.id, projects.tenantId))
        .where(
          and(
            eq(projects.id, input.connection.scope.projectId),
            eq(projects.tenantId, input.connection.scope.tenantId),
          ),
        )
        .limit(1);
      if (boundProject === undefined) {
        throw new DomainError(
          'policy_denied',
          'Integration project binding does not belong to the selected tenant.',
        );
      }
      if (
        (input.kind === 'github-app' || input.kind === 'vercel') &&
        (boundProject.tenantKey !== webbinPilotBinding.tenantKey ||
          boundProject.projectKey !== webbinPilotBinding.projectKey)
      ) {
        throw new DomainError(
          'policy_denied',
          'The external Webbin binding is authorized only for webbin/webbin.',
        );
      }
    } else if (input.kind === 'github-app' || input.kind === 'vercel') {
      throw new DomainError(
        'validation_error',
        `${input.kind} requires a project integration connection.`,
      );
    }
    const conditions = scopeConditions({
      kind: input.kind,
      ownerScope: input.ownerScope,
      projectId: input.scope.projectId,
      tenantId: input.scope.tenantId,
    });
    const [versionRow] = await tx
      .select({ value: max(providerCredentials.version) })
      .from(providerCredentials)
      .where(and(...conditions));
    const version = (versionRow?.value ?? 0) + 1;
    const secretReferenceId = uuidv7();

    await tx.insert(secretReferences).values({
      ...input.envelope,
      credentialVersion: version,
      id: secretReferenceId,
      projectId: input.scope.projectId,
      provider: input.kind,
      tenantId: input.scope.tenantId,
    });
    await tx.insert(providerCredentials).values({
      alias: input.alias,
      configuration: input.configuration,
      id: input.credentialId,
      kind: input.kind,
      maskedSuffix: input.maskedSuffix,
      ownerScope: input.ownerScope,
      projectId: input.scope.projectId,
      secretReferenceId,
      tenantId: input.scope.tenantId,
      version,
    });
    if (input.connection !== undefined) {
      await tx.insert(integrationConnections).values({
        configuration: input.connection.configuration,
        credentialId: input.credentialId,
        id: uuidv7(),
        kind: input.connection.kind,
        projectId: input.connection.scope.projectId,
        tenantId: input.connection.scope.tenantId,
      });
    }
    await tx.insert(credentialEvents).values({
      action: 'created',
      credentialId: input.credentialId,
      id: uuidv7(),
      metadata: { ownerScope: input.ownerScope, version },
      projectId: input.connection?.scope.projectId ?? input.scope.projectId,
      tenantId: input.connection?.scope.tenantId ?? input.scope.tenantId,
    });
    return input.credentialId;
  });
};

export const listCredentials = async (db: Database) =>
  db
    .select({
      alias: providerCredentials.alias,
      createdAt: providerCredentials.createdAt,
      id: providerCredentials.id,
      kind: providerCredentials.kind,
      maskedSuffix: providerCredentials.maskedSuffix,
      ownerScope: providerCredentials.ownerScope,
      projectId: providerCredentials.projectId,
      status: providerCredentials.status,
      tenantId: providerCredentials.tenantId,
      testedAt: providerCredentials.testedAt,
      verifiedAt: providerCredentials.verifiedAt,
      version: providerCredentials.version,
    })
    .from(providerCredentials)
    .orderBy(desc(providerCredentials.createdAt));

export const getCredentialForVerification = async (
  db: Database,
  credentialId: string,
): Promise<CredentialForVerification | undefined> => {
  const [row] = await db
    .select({
      authTag: secretReferences.authTag,
      ciphertext: secretReferences.ciphertext,
      configuration: providerCredentials.configuration,
      connectionConfiguration: integrationConnections.configuration,
      connectionId: integrationConnections.id,
      connectionProjectId: integrationConnections.projectId,
      connectionTenantId: integrationConnections.tenantId,
      credentialId: providerCredentials.id,
      keyVersion: secretReferences.keyVersion,
      kind: providerCredentials.kind,
      nonce: secretReferences.nonce,
      ownerScope: providerCredentials.ownerScope,
      projectId: providerCredentials.projectId,
      status: providerCredentials.status,
      tenantId: providerCredentials.tenantId,
      version: providerCredentials.version,
      wrapAuthTag: secretReferences.wrapAuthTag,
      wrappedDek: secretReferences.wrappedDek,
      wrapNonce: secretReferences.wrapNonce,
    })
    .from(providerCredentials)
    .innerJoin(
      secretReferences,
      eq(providerCredentials.secretReferenceId, secretReferences.id),
    )
    .leftJoin(
      integrationConnections,
      eq(integrationConnections.credentialId, providerCredentials.id),
    )
    .where(eq(providerCredentials.id, credentialId))
    .limit(1);
  if (row === undefined) return undefined;
  if (row.kind === 'github-app' || row.kind === 'vercel') {
    if (
      row.connectionProjectId === null ||
      row.connectionTenantId === null ||
      row.connectionId === null
    ) {
      throw new DomainError(
        'validation_error',
        `${row.kind} credential is missing its project connection.`,
      );
    }
    const [authorizedProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(tenants, eq(tenants.id, projects.tenantId))
      .where(
        and(
          eq(projects.id, row.connectionProjectId),
          eq(projects.tenantId, row.connectionTenantId),
          eq(projects.key, webbinPilotBinding.projectKey),
          eq(tenants.key, webbinPilotBinding.tenantKey),
        ),
      )
      .limit(1);
    if (authorizedProject === undefined) {
      throw new DomainError(
        'policy_denied',
        'Credential connection is not authorized for the Webbin pilot scope.',
      );
    }
    if (
      row.ownerScope === 'project' &&
      (row.projectId !== row.connectionProjectId ||
        row.tenantId !== row.connectionTenantId)
    ) {
      throw new DomainError(
        'policy_denied',
        'Project-owned credential scope does not match its connection.',
      );
    }
  }
  const secretTenantId =
    row.ownerScope === 'platform' ? 'platform' : row.tenantId;
  if (secretTenantId === null) {
    throw new DomainError(
      'internal_error',
      'Credential ownership is inconsistent with its encryption context.',
    );
  }

  return {
    configuration: asConfiguration(row.configuration),
    ...(row.connectionId === null
      ? {}
      : {
          connection: {
            configuration: asConfiguration(row.connectionConfiguration),
            id: row.connectionId,
            ...(row.connectionProjectId === null
              ? {}
              : { projectId: row.connectionProjectId }),
            ...(row.connectionTenantId === null
              ? {}
              : { tenantId: row.connectionTenantId }),
          },
        }),
    envelope: {
      algorithm: 'aes-256-gcm',
      authTag: row.authTag,
      ciphertext: row.ciphertext,
      keyVersion: row.keyVersion,
      nonce: row.nonce,
      wrapAuthTag: row.wrapAuthTag,
      wrappedDek: row.wrappedDek,
      wrapNonce: row.wrapNonce,
    },
    id: row.credentialId,
    kind: row.kind as IntegrationKind,
    ownerScope: row.ownerScope,
    ...(row.projectId === null ? {} : { projectId: row.projectId }),
    secretContext: {
      credentialId: row.credentialId,
      keyVersion: row.keyVersion,
      provider: row.kind,
      tenantId: secretTenantId,
    },
    status: row.status,
    ...(row.tenantId === null ? {} : { tenantId: row.tenantId }),
    version: row.version,
  };
};

export const listCredentialIdsForVerification = async (
  db: Database,
): Promise<string[]> => {
  const rows = await db
    .select({
      id: providerCredentials.id,
      kind: providerCredentials.kind,
      ownerScope: providerCredentials.ownerScope,
      projectId: providerCredentials.projectId,
      status: providerCredentials.status,
      tenantId: providerCredentials.tenantId,
      version: providerCredentials.version,
    })
    .from(providerCredentials)
    .where(inArray(providerCredentials.status, ['active', 'unverified']))
    .orderBy(
      asc(providerCredentials.kind),
      asc(providerCredentials.ownerScope),
      asc(providerCredentials.tenantId),
      asc(providerCredentials.projectId),
      desc(providerCredentials.version),
    );

  const newestCandidateByScope = new Set<string>();
  return rows
    .filter((row) => {
      if (row.status === 'active') return true;
      const key = [
        row.kind,
        row.ownerScope,
        row.tenantId ?? 'platform',
        row.projectId ?? 'platform',
      ].join(':');
      if (newestCandidateByScope.has(key)) return false;
      newestCandidateByScope.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftKey = `${left.kind}:${left.ownerScope}:${left.tenantId ?? ''}:${left.projectId ?? ''}:${left.status === 'active' ? '0' : '1'}`;
      const rightKey = `${right.kind}:${right.ownerScope}:${right.tenantId ?? ''}:${right.projectId ?? ''}:${right.status === 'active' ? '0' : '1'}`;
      return leftKey.localeCompare(rightKey);
    })
    .map((row) => row.id);
};

export const recordCredentialVerificationSuccess = async (
  db: Database,
  input: Readonly<{
    checkedAt: Date;
    credentialId: string;
    evidence: SafeConfiguration;
  }>,
): Promise<void> =>
  db.transaction(async (tx) => {
    const initialCredential = await tx.query.providerCredentials.findFirst({
      where: eq(providerCredentials.id, input.credentialId),
    });
    if (initialCredential === undefined) {
      throw new DomainError(
        'credential_unavailable',
        'Credential was not found while recording verification.',
      );
    }
    const lockKey = ownershipLockKey(initialCredential);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const externalResourceId =
      typeof input.evidence.externalResourceId === 'string'
        ? input.evidence.externalResourceId
        : undefined;
    if (
      externalResourceId !== undefined &&
      (initialCredential.kind === 'telegram-admin' ||
        initialCredential.kind === 'telegram-client')
    ) {
      const telegramLockKey = `telegram-bot:${externalResourceId}`;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${telegramLockKey}))`,
      );
    }
    await tx.execute(
      sql`select id from provider_credentials where id = ${input.credentialId} for update`,
    );
    const credential = await tx.query.providerCredentials.findFirst({
      where: eq(providerCredentials.id, input.credentialId),
    });
    if (credential === undefined) {
      throw new DomainError(
        'credential_unavailable',
        'Credential was not found while recording verification.',
      );
    }
    if (credential.status === 'revoked' || credential.status === 'superseded') {
      throw new DomainError(
        'credential_unavailable',
        'Credential became unavailable during verification.',
      );
    }
    if (
      credential.testedAt !== null &&
      credential.testedAt.getTime() > input.checkedAt.getTime()
    ) {
      throw new DomainError(
        'conflict_error',
        'A newer verification attempt is already recorded.',
      );
    }

    const currentActive = await tx.query.providerCredentials.findFirst({
      orderBy: desc(providerCredentials.version),
      where: and(
        ...scopeConditions(credential),
        eq(providerCredentials.status, 'active'),
        ne(providerCredentials.id, credential.id),
      ),
    });
    if (
      currentActive !== undefined &&
      currentActive.version > credential.version
    ) {
      throw new DomainError(
        'conflict_error',
        'A newer credential version is already active for this scope.',
      );
    }
    if (
      externalResourceId !== undefined &&
      (credential.kind === 'telegram-admin' ||
        credential.kind === 'telegram-client')
    ) {
      const duplicateBot = await tx.query.providerCredentials.findFirst({
        where: and(
          inArray(providerCredentials.kind, [
            'telegram-admin',
            'telegram-client',
          ]),
          eq(providerCredentials.status, 'active'),
          eq(providerCredentials.externalResourceId, externalResourceId),
          ne(providerCredentials.id, credential.id),
        ),
      });
      if (duplicateBot !== undefined && duplicateBot.id !== currentActive?.id) {
        throw new DomainError(
          'policy_denied',
          'Telegram bot identity is already active in another binding.',
        );
      }
    }

    const replaced = await tx
      .update(providerCredentials)
      .set({ status: 'superseded' })
      .where(
        and(
          ...scopeConditions(credential),
          eq(providerCredentials.status, 'active'),
          ne(providerCredentials.id, credential.id),
        ),
      )
      .returning({
        id: providerCredentials.id,
        projectId: providerCredentials.projectId,
        tenantId: providerCredentials.tenantId,
      });
    for (const previous of replaced) {
      await tx
        .update(integrationConnections)
        .set({ status: 'superseded', updatedAt: input.checkedAt })
        .where(eq(integrationConnections.credentialId, previous.id));
      const previousAuditScope = await auditScope(tx, previous.id, previous);
      await tx.insert(credentialEvents).values({
        action: 'superseded',
        credentialId: previous.id,
        id: uuidv7(),
        metadata: { replacedBy: credential.id },
        projectId: previousAuditScope.projectId,
        tenantId: previousAuditScope.tenantId,
      });
    }

    const [updated] = await tx
      .update(providerCredentials)
      .set({
        ...(externalResourceId === undefined ? {} : { externalResourceId }),
        status: 'active',
        testedAt: input.checkedAt,
        verifiedAt: input.checkedAt,
        verificationEvidence: input.evidence,
      })
      .where(
        and(
          eq(providerCredentials.id, credential.id),
          ne(providerCredentials.status, 'revoked'),
        ),
      )
      .returning({ id: providerCredentials.id });
    if (updated === undefined) {
      throw new Error('Credential was revoked during verification.');
    }
    await tx
      .update(integrationConnections)
      .set({
        ...(externalResourceId === undefined ? {} : { externalResourceId }),
        status: 'active',
        testedAt: input.checkedAt,
        updatedAt: input.checkedAt,
        verifiedAt: input.checkedAt,
        verificationEvidence: input.evidence,
      })
      .where(eq(integrationConnections.credentialId, credential.id));
    const credentialAuditScope = await auditScope(
      tx,
      credential.id,
      credential,
    );
    await tx.insert(credentialEvents).values({
      action: 'verified',
      credentialId: credential.id,
      id: uuidv7(),
      metadata: { evidence: input.evidence, outcome: 'success' },
      projectId: credentialAuditScope.projectId,
      tenantId: credentialAuditScope.tenantId,
    });
  });

export const recordCredentialVerificationFailure = async (
  db: Database,
  input: Readonly<{
    category: ErrorCategory;
    checkedAt: Date;
    credentialId: string;
    permanent: boolean;
  }>,
): Promise<void> =>
  db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from provider_credentials where id = ${input.credentialId} for update`,
    );
    const credential = await tx.query.providerCredentials.findFirst({
      where: eq(providerCredentials.id, input.credentialId),
    });
    if (credential === undefined) {
      throw new DomainError(
        'credential_unavailable',
        'Credential was not found while recording verification.',
      );
    }
    if (credential.status === 'revoked' || credential.status === 'superseded') {
      throw new DomainError(
        'credential_unavailable',
        'Credential became unavailable during verification.',
      );
    }
    if (
      credential.testedAt !== null &&
      credential.testedAt.getTime() > input.checkedAt.getTime()
    ) {
      const credentialAuditScope = await auditScope(
        tx,
        credential.id,
        credential,
      );
      await tx.insert(credentialEvents).values({
        action: 'verification_discarded',
        credentialId: credential.id,
        id: uuidv7(),
        metadata: {
          category: input.category,
          checkedAt: input.checkedAt.toISOString(),
          reason: 'newer_attempt_recorded',
        },
        projectId: credentialAuditScope.projectId,
        tenantId: credentialAuditScope.tenantId,
      });
      return;
    }
    await tx
      .update(providerCredentials)
      .set({
        ...(input.permanent ? { status: 'invalid' as const } : {}),
        testedAt: input.checkedAt,
      })
      .where(
        and(
          eq(providerCredentials.id, credential.id),
          ne(providerCredentials.status, 'revoked'),
        ),
      );
    await tx
      .update(integrationConnections)
      .set({
        ...(input.permanent ? { status: 'invalid' as const } : {}),
        testedAt: input.checkedAt,
        updatedAt: input.checkedAt,
      })
      .where(eq(integrationConnections.credentialId, credential.id));
    const credentialAuditScope = await auditScope(
      tx,
      credential.id,
      credential,
    );
    await tx.insert(credentialEvents).values({
      action: 'verification_failed',
      credentialId: credential.id,
      id: uuidv7(),
      metadata: {
        category: input.category,
        outcome: 'failed',
        permanent: input.permanent,
      },
      projectId: credentialAuditScope.projectId,
      tenantId: credentialAuditScope.tenantId,
    });
  });

export const revokeCredential = async (
  db: Database,
  credentialId: string,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from provider_credentials where id = ${credentialId} for update`,
    );
    const credential = await tx.query.providerCredentials.findFirst({
      where: eq(providerCredentials.id, credentialId),
    });
    if (credential === undefined) return false;
    if (credential.status === 'revoked') return true;
    const revokedAt = new Date();
    await tx
      .update(providerCredentials)
      .set({ revokedAt, status: 'revoked' })
      .where(eq(providerCredentials.id, credentialId));
    await tx
      .update(secretReferences)
      .set({ revokedAt })
      .where(eq(secretReferences.id, credential.secretReferenceId));
    await tx
      .update(integrationConnections)
      .set({ status: 'revoked', updatedAt: revokedAt })
      .where(eq(integrationConnections.credentialId, credentialId));
    const credentialAuditScope = await auditScope(
      tx,
      credential.id,
      credential,
    );
    await tx.insert(credentialEvents).values({
      action: 'revoked',
      credentialId,
      id: uuidv7(),
      projectId: credentialAuditScope.projectId,
      tenantId: credentialAuditScope.tenantId,
    });
    return true;
  });
