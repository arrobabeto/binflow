import { and, desc, eq, isNull, max } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { IntegrationKind } from '@binflow/contracts';
import type { EncryptedSecretEnvelope } from '@binflow/secrets';

import type { Database } from './client.js';
import {
  credentialEvents,
  projects,
  providerCredentials,
  secretReferences,
  tenants,
} from './schema.js';

export type ResolvedScope = Readonly<{
  tenantId?: string;
  projectId?: string;
}>;

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
    const project = await db.query.projects.findFirst({
      where: eq(projects.key, input.projectKey),
    });
    if (project === undefined) {
      throw new Error(`Unknown project scope: ${input.projectKey}`);
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
    credentialId: string;
    envelope: EncryptedSecretEnvelope;
    kind: IntegrationKind;
    maskedSuffix: string;
    scope: ResolvedScope;
  }>,
): Promise<string> =>
  db.transaction(async (tx) => {
    const scopeConditions = [
      input.scope.tenantId === undefined
        ? isNull(providerCredentials.tenantId)
        : eq(providerCredentials.tenantId, input.scope.tenantId),
      input.scope.projectId === undefined
        ? isNull(providerCredentials.projectId)
        : eq(providerCredentials.projectId, input.scope.projectId),
      eq(providerCredentials.kind, input.kind),
    ];
    const [versionRow] = await tx
      .select({ value: max(providerCredentials.version) })
      .from(providerCredentials)
      .where(and(...scopeConditions));
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
      id: input.credentialId,
      kind: input.kind,
      maskedSuffix: input.maskedSuffix,
      projectId: input.scope.projectId,
      secretReferenceId,
      tenantId: input.scope.tenantId,
      version,
    });
    await tx.insert(credentialEvents).values({
      action: 'created',
      credentialId: input.credentialId,
      id: uuidv7(),
      metadata: { version },
      projectId: input.scope.projectId,
      tenantId: input.scope.tenantId,
    });
    return input.credentialId;
  });

export const listCredentials = async (db: Database) =>
  db
    .select({
      alias: providerCredentials.alias,
      createdAt: providerCredentials.createdAt,
      id: providerCredentials.id,
      kind: providerCredentials.kind,
      maskedSuffix: providerCredentials.maskedSuffix,
      projectId: providerCredentials.projectId,
      status: providerCredentials.status,
      tenantId: providerCredentials.tenantId,
      testedAt: providerCredentials.testedAt,
      version: providerCredentials.version,
    })
    .from(providerCredentials)
    .orderBy(desc(providerCredentials.createdAt));

export const revokeCredential = async (
  db: Database,
  credentialId: string,
): Promise<boolean> =>
  db.transaction(async (tx) => {
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
    await tx.insert(credentialEvents).values({
      action: 'revoked',
      credentialId,
      id: uuidv7(),
      projectId: credential.projectId,
      tenantId: credential.tenantId,
    });
    return true;
  });
