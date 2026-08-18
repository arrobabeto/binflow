import { createHash, createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  createOpenAICredentialVerifier,
  phase0OpenAIModels,
} from '@binflow/ai';
import {
  credentialSummarySchema,
  credentialVerificationResponseSchema,
  integrationCandidateInputSchema,
  webbinPilotBinding,
  type CredentialSummary,
  type CredentialVerificationResponse,
  type IntegrationCandidateInput,
} from '@binflow/contracts';
import {
  completeIdempotencyRecord,
  hashCanonicalRequest,
  listCredentials,
  reserveIdempotencyKey,
  resolveScope,
  revokeCredential,
  schema,
  storeCredentialVersion,
  withPlatformOwnerScope,
  type Database,
  type JsonValue,
  type ResolvedScope,
  type ScopedDatabase,
} from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { createGitHubCredentialVerifier } from '@binflow/github';
import {
  createDatabaseCredentialVerificationRepository,
  CredentialVerificationService,
  type CredentialVerifier,
} from '@binflow/integrations';
import { createTelegramCredentialVerifier } from '@binflow/messaging';
import { encryptSecret } from '@binflow/secrets';
import { createVercelCredentialVerifier } from '@binflow/vercel';

export type IntegrationActorContext = Readonly<{
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
}>;

type KeyLoader = () => Promise<Buffer>;

const asJson = (value: unknown): JsonValue => value as JsonValue;
const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

const safeCandidateRequest = (
  input: IntegrationCandidateInput,
  secretMac: string,
): JsonValue => {
  if (input.kind === 'openai') {
    return {
      alias: input.alias,
      kind: input.kind,
      secretMac,
      tenantKey: input.tenantKey,
    };
  }
  if (input.kind === 'telegram-admin') {
    return {
      alias: input.alias,
      expectedUsername: input.expectedUsername,
      kind: input.kind,
      secretMac,
    };
  }
  if (input.kind === 'telegram-client') {
    return {
      alias: input.alias,
      expectedUsername: input.expectedUsername,
      kind: input.kind,
      secretMac,
      tenantKey: input.tenantKey,
    };
  }
  if (input.kind === 'github-app') {
    return {
      alias: input.alias,
      appId: input.appId,
      clientId: input.clientId,
      kind: input.kind,
      projectKey: input.projectKey,
      secretMac,
      tenantKey: input.tenantKey,
    };
  }
  return {
    alias: input.alias,
    kind: input.kind,
    projectId: input.projectId,
    projectKey: input.projectKey,
    secretMac,
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    tenantKey: input.tenantKey,
  };
};

const requireCredential = async (
  database: ScopedDatabase,
  credentialId: string,
  expectedRevision?: number,
) => {
  const credential = await database.query.providerCredentials.findFirst({
    where: eq(schema.providerCredentials.id, credentialId),
  });
  if (credential === undefined) {
    throw new DomainError('validation_error', 'Credential was not found.', {
      code: 'credential_not_found',
    });
  }
  if (
    expectedRevision !== undefined &&
    credential.revision !== expectedRevision
  ) {
    throw new DomainError(
      'conflict_error',
      'Credential changed after the dashboard resource was loaded.',
    );
  }
  return credential;
};

const listSafeCredentials = async (
  database: ScopedDatabase,
): Promise<CredentialSummary[]> => {
  const rows = await listCredentials(database);
  const connections = await database
    .select()
    .from(schema.integrationConnections);
  const tenantRows = await database.select().from(schema.tenants);
  const projectRows = await database.select().from(schema.projects);
  const connectionByCredential = new Map(
    connections.map((connection) => [connection.credentialId, connection]),
  );
  const tenantKeyById = new Map(
    tenantRows.map((tenant) => [tenant.id, tenant.key]),
  );
  const projectKeyById = new Map(
    projectRows.map((project) => [project.id, project.key]),
  );
  return rows.map((row) => {
    const connection = connectionByCredential.get(row.id);
    const bindingTenantId = connection?.tenantId ?? row.tenantId;
    const bindingProjectId = connection?.projectId ?? row.projectId;
    return credentialSummarySchema.parse({
      alias: row.alias,
      bindingProjectKey:
        bindingProjectId === null
          ? null
          : (projectKeyById.get(bindingProjectId) ?? null),
      bindingTenantKey:
        bindingTenantId === null
          ? null
          : (tenantKeyById.get(bindingTenantId) ?? null),
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      kind: row.kind,
      maskedSuffix: row.maskedSuffix,
      ownerScope: row.ownerScope,
      projectId: row.projectId,
      revision: row.revision,
      status: row.status,
      tenantId: row.tenantId,
      testedAt: iso(row.testedAt),
      usedAt: iso(row.usedAt),
      verifiedAt: iso(row.verifiedAt),
      version: row.version,
    });
  });
};

const selectSafeCredential = async (
  database: ScopedDatabase,
  credentialId: string,
): Promise<CredentialSummary> => {
  const credential = (await listSafeCredentials(database)).find(
    (item) => item.id === credentialId,
  );
  if (credential === undefined) {
    throw new DomainError(
      'internal_error',
      'Credential summary is unavailable.',
    );
  }
  return credential;
};

const mutationScope = async (
  database: ScopedDatabase,
  credential: Readonly<{
    id: string;
    projectId: string | null;
    tenantId: string | null;
  }>,
): Promise<Readonly<{ projectId?: string; tenantId?: string }>> => {
  const connection = await database.query.integrationConnections.findFirst({
    where: eq(schema.integrationConnections.credentialId, credential.id),
  });
  const projectId = connection?.projectId ?? credential.projectId;
  const tenantId = connection?.tenantId ?? credential.tenantId;
  return {
    ...(projectId === null ? {} : { projectId }),
    ...(tenantId === null ? {} : { tenantId }),
  };
};

const reserve = async (
  database: ScopedDatabase,
  context: IntegrationActorContext,
  input: Readonly<{
    requestHash: string;
    route: string;
    tenantId?: string;
    projectId?: string;
  }>,
) => {
  const reservation = await reserveIdempotencyKey(database, {
    actorId: context.actorId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    idempotencyKey: context.idempotencyKey,
    method: 'POST',
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    requestHash: input.requestHash,
    route: input.route,
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
  });
  if (reservation.kind === 'replay') {
    if (reservation.status !== 'completed') {
      throw new DomainError(
        'conflict_error',
        'The request is still processing.',
        {
          code: 'idempotency_in_progress',
        },
      );
    }
    return { replay: reservation.responseBody as JsonValue } as const;
  }
  return { id: reservation.id } as const;
};

const recordMutation = async (
  database: ScopedDatabase,
  input: Readonly<{
    action: string;
    actorId: string;
    correlationId: string;
    credentialId: string;
    eventType: string;
    projectId?: string;
    tenantId?: string;
    revision: number;
  }>,
): Promise<void> => {
  const scope = {
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
  };
  await database.insert(schema.auditEvents).values({
    action: input.action,
    actorId: input.actorId,
    actorType: 'platform_owner',
    correlationId: input.correlationId,
    id: uuidv7(),
    metadata: { revision: input.revision },
    objectId: input.credentialId,
    objectType: 'provider_credential',
    ...scope,
  });
  await database.insert(schema.outboxEvents).values({
    aggregateId: input.credentialId,
    aggregateType: 'provider_credential',
    eventType: input.eventType,
    eventVersion: 1,
    id: uuidv7(),
    jobKey: `${input.eventType}:${input.credentialId}:${String(input.revision)}`,
    payload: { revision: input.revision },
    ...scope,
  });
};

const candidateMaterial = async (
  database: ScopedDatabase,
  input: IntegrationCandidateInput,
): Promise<
  Readonly<{
    configuration: Readonly<Record<string, unknown>>;
    connection?: Readonly<{
      configuration: Readonly<Record<string, unknown>>;
      kind: IntegrationCandidateInput['kind'];
      scope: Required<ResolvedScope>;
    }>;
    ownerScope: 'platform' | 'tenant' | 'project';
    plaintext: Buffer;
    scope: ResolvedScope;
    secretSuffix: string;
  }>
> => {
  if (input.kind === 'openai') {
    const scope = await resolveScope(database, { tenantKey: input.tenantKey });
    return {
      configuration: { requiredModels: [...phase0OpenAIModels] },
      ownerScope: 'tenant',
      plaintext: Buffer.from(JSON.stringify({ apiKey: input.apiKey })),
      scope,
      secretSuffix: input.apiKey.slice(-4),
    };
  }
  if (input.kind === 'telegram-admin') {
    return {
      configuration: {
        expectedUsername: input.expectedUsername,
        role: 'admin',
      },
      ownerScope: 'platform',
      plaintext: Buffer.from(JSON.stringify({ botToken: input.botToken })),
      scope: {},
      secretSuffix: input.botToken.slice(-4),
    };
  }
  if (input.kind === 'telegram-client') {
    const scope = await resolveScope(database, { tenantKey: input.tenantKey });
    return {
      configuration: {
        expectedUsername: input.expectedUsername,
        role: 'client',
      },
      ownerScope: 'tenant',
      plaintext: Buffer.from(JSON.stringify({ botToken: input.botToken })),
      scope,
      secretSuffix: input.botToken.slice(-4),
    };
  }
  const resolvedBinding = await resolveScope(database, {
    projectKey: input.projectKey,
    tenantKey: input.tenantKey,
  });
  if (
    resolvedBinding.projectId === undefined ||
    resolvedBinding.tenantId === undefined
  ) {
    throw new DomainError('internal_error', 'Project binding is incomplete.');
  }
  const binding: Required<ResolvedScope> = {
    projectId: resolvedBinding.projectId,
    tenantId: resolvedBinding.tenantId,
  };
  if (
    input.tenantKey !== webbinPilotBinding.tenantKey ||
    input.projectKey !== webbinPilotBinding.projectKey
  ) {
    throw new DomainError(
      'policy_denied',
      'Phase 0 external integrations are limited to the Webbin pilot.',
    );
  }
  if (input.kind === 'github-app') {
    return {
      configuration: { appId: input.appId, clientId: input.clientId },
      connection: {
        configuration: {
          defaultBranch: webbinPilotBinding.productionBranch,
          expectedRepository: webbinPilotBinding.repository,
        },
        kind: input.kind,
        scope: binding,
      },
      ownerScope: 'platform',
      plaintext: Buffer.from(
        JSON.stringify({
          privateKey: input.privateKey,
          webhookSecret: input.webhookSecret,
        }),
      ),
      scope: {},
      secretSuffix: createHash('sha256')
        .update(input.privateKey)
        .digest('hex')
        .slice(-4),
    };
  }
  return {
    configuration: {},
    connection: {
      configuration: {
        expectedProductionBranch: webbinPilotBinding.productionBranch,
        expectedRepository: webbinPilotBinding.repository,
        projectId: input.projectId,
        ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
      },
      kind: input.kind,
      scope: binding,
    },
    ownerScope: 'project',
    plaintext: Buffer.from(JSON.stringify({ token: input.token })),
    scope: binding,
    secretSuffix: input.token.slice(-4),
  };
};

export class IntegrationAdminService {
  public constructor(
    private readonly database: Database,
    private readonly loadMasterKey: KeyLoader,
    private readonly verifiers: readonly CredentialVerifier[] = [
      createOpenAICredentialVerifier(),
      createTelegramCredentialVerifier(),
      createGitHubCredentialVerifier(),
      createVercelCredentialVerifier(),
    ],
  ) {}

  public list(
    actorId: string,
    correlationId: string,
  ): Promise<CredentialSummary[]> {
    return withPlatformOwnerScope(
      this.database,
      { actorId, correlationId, reason: 'List provider credentials' },
      listSafeCredentials,
    );
  }

  public async create(
    rawInput: IntegrationCandidateInput,
    context: IntegrationActorContext,
  ): Promise<CredentialSummary> {
    const input = integrationCandidateInputSchema.parse(rawInput);
    const masterKey = await this.loadMasterKey();
    let plaintext: Buffer | undefined;
    try {
      return await withPlatformOwnerScope(
        this.database,
        {
          actorId: context.actorId,
          correlationId: context.correlationId,
          reason: 'Register provider credential candidate',
        },
        async (database) => {
          const material = await candidateMaterial(database, input);
          plaintext = material.plaintext;
          const secretMac = createHmac('sha256', masterKey)
            .update(plaintext)
            .digest('hex');
          const requestHash = hashCanonicalRequest(
            safeCandidateRequest(input, secretMac),
          );
          const requestScope = material.connection?.scope ?? material.scope;
          const reserved = await reserve(database, context, {
            requestHash,
            route: '/api/v1/admin/integrations',
            ...(requestScope.projectId === undefined
              ? {}
              : { projectId: requestScope.projectId }),
            ...(requestScope.tenantId === undefined
              ? {}
              : { tenantId: requestScope.tenantId }),
          });
          if ('replay' in reserved) {
            return credentialSummarySchema.parse(reserved.replay);
          }
          const credentialId = uuidv7();
          const tenantContext =
            material.ownerScope === 'platform'
              ? 'platform'
              : material.scope.tenantId;
          if (tenantContext === undefined) {
            throw new DomainError(
              'internal_error',
              'Secret scope is incomplete.',
            );
          }
          const envelope = encryptSecret(plaintext, masterKey, {
            credentialId,
            keyVersion: 1,
            provider: input.kind,
            tenantId: tenantContext,
          });
          await storeCredentialVersion(database, {
            alias: input.alias,
            configuration: material.configuration,
            ...(material.connection === undefined
              ? {}
              : { connection: material.connection }),
            credentialId,
            envelope,
            kind: input.kind,
            maskedSuffix: material.secretSuffix,
            ownerScope: material.ownerScope,
            scope: material.scope,
          });
          const summary = await selectSafeCredential(database, credentialId);
          const auditScope = material.connection?.scope ?? material.scope;
          await recordMutation(database, {
            action: 'credential.candidate_created',
            actorId: context.actorId,
            correlationId: context.correlationId,
            credentialId,
            eventType: 'credential.candidate_created',
            ...(auditScope.projectId === undefined
              ? {}
              : { projectId: auditScope.projectId }),
            revision: summary.revision,
            ...(auditScope.tenantId === undefined
              ? {}
              : { tenantId: auditScope.tenantId }),
          });
          await completeIdempotencyRecord(database, {
            id: reserved.id,
            responseBody: asJson(summary),
            responseStatus: 200,
            status: 'completed',
          });
          return summary;
        },
      );
    } finally {
      plaintext?.fill(0);
      masterKey.fill(0);
    }
  }

  public async verify(
    credentialId: string,
    expectedRevision: number,
    context: IntegrationActorContext,
  ): Promise<CredentialVerificationResponse> {
    const masterKey = await this.loadMasterKey();
    try {
      return await withPlatformOwnerScope(
        this.database,
        {
          actorId: context.actorId,
          correlationId: context.correlationId,
          reason: 'Verify provider credential',
        },
        async (database) => {
          const before = await requireCredential(database, credentialId);
          const auditScope = await mutationScope(database, before);
          const reserved = await reserve(database, context, {
            requestHash: hashCanonicalRequest({
              credentialId,
              expectedRevision,
            }),
            route: `/api/v1/admin/integrations/${credentialId}/verify`,
            ...auditScope,
          });
          if ('replay' in reserved) {
            return credentialVerificationResponseSchema.parse(reserved.replay);
          }
          await requireCredential(database, credentialId, expectedRevision);
          const service = new CredentialVerificationService(
            createDatabaseCredentialVerificationRepository(database),
            this.verifiers,
          );
          const result = await service.verify(credentialId, masterKey);
          const credential = await selectSafeCredential(database, credentialId);
          const view: CredentialVerificationResponse = {
            credential,
            ...(result.errorCategory === undefined
              ? {}
              : { errorCategory: result.errorCategory }),
            outcome: result.outcome,
          };
          await recordMutation(database, {
            action: 'credential.verification_requested',
            actorId: context.actorId,
            correlationId: context.correlationId,
            credentialId,
            eventType: 'credential.verification_completed',
            ...auditScope,
            revision: credential.revision,
          });
          await completeIdempotencyRecord(database, {
            id: reserved.id,
            responseBody: asJson(view),
            responseStatus: 200,
            status: 'completed',
          });
          return view;
        },
      );
    } finally {
      masterKey.fill(0);
    }
  }

  public revoke(
    credentialId: string,
    expectedRevision: number,
    context: IntegrationActorContext,
  ): Promise<CredentialSummary> {
    return withPlatformOwnerScope(
      this.database,
      {
        actorId: context.actorId,
        correlationId: context.correlationId,
        reason: 'Revoke provider credential',
      },
      async (database) => {
        const before = await requireCredential(database, credentialId);
        const auditScope = await mutationScope(database, before);
        const reserved = await reserve(database, context, {
          requestHash: hashCanonicalRequest({ credentialId, expectedRevision }),
          route: `/api/v1/admin/integrations/${credentialId}/revoke`,
          ...auditScope,
        });
        if ('replay' in reserved) {
          return credentialSummarySchema.parse(reserved.replay);
        }
        await requireCredential(database, credentialId, expectedRevision);
        await revokeCredential(database, credentialId, expectedRevision);
        const summary = await selectSafeCredential(database, credentialId);
        await recordMutation(database, {
          action: 'credential.revoked',
          actorId: context.actorId,
          correlationId: context.correlationId,
          credentialId,
          eventType: 'credential.revoked',
          ...auditScope,
          revision: summary.revision,
        });
        await completeIdempotencyRecord(database, {
          id: reserved.id,
          responseBody: asJson(summary),
          responseStatus: 200,
          status: 'completed',
        });
        return summary;
      },
    );
  }
}
