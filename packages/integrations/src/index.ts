import type { IntegrationKind } from '@binflow/contracts';
import {
  type CredentialForVerification,
  getCredentialForVerification,
  listCredentialIdsForVerification,
  recordCredentialVerificationFailure,
  recordCredentialVerificationSuccess,
  type SafeConfiguration,
  type ScopedDatabase,
} from '@binflow/db';
import {
  DomainError,
  systemClock,
  type Clock,
  type ErrorCategory,
} from '@binflow/domain';
import { z } from 'zod';

export type VerificationEvidence = SafeConfiguration;

const evidenceSchemas = {
  openai: z
    .object({
      modelCount: z.number().int().nonnegative(),
      requestId: z.string().min(1).optional(),
      requiredModels: z.array(z.string().min(1)),
    })
    .strict(),
  'telegram-admin': z
    .object({
      botId: z.string().regex(/^\d+$/),
      externalResourceId: z.string().regex(/^\d+$/),
      pendingUpdateCount: z.number().int().nonnegative(),
      role: z.literal('admin'),
      transport: z.literal('polling'),
      username: z.string().min(1),
      webhookConfigured: z.literal(false),
    })
    .strict(),
  'telegram-client': z
    .object({
      botId: z.string().regex(/^\d+$/),
      externalResourceId: z.string().regex(/^\d+$/),
      pendingUpdateCount: z.number().int().nonnegative(),
      role: z.literal('client'),
      transport: z.literal('polling'),
      username: z.string().min(1),
      webhookConfigured: z.literal(false),
    })
    .strict(),
  'github-app': z
    .object({
      appId: z.string().regex(/^\d+$/),
      appSlug: z.string().min(1),
      defaultBranch: z.string().min(1),
      externalResourceId: z.string().regex(/^\d+$/),
      installationAccount: z.string().min(1),
      installationId: z.string().regex(/^\d+$/),
      permissionHash: z.string().regex(/^[a-f0-9]{64}$/),
      repository: z.string().regex(/^[^/]+\/[^/]+$/),
      repositoryId: z.string().regex(/^\d+$/),
      webhookVerification: z.literal('pending_signed_delivery'),
    })
    .strict(),
  vercel: z
    .object({
      accountId: z.string().min(1),
      externalResourceId: z.string().min(1),
      gitProvider: z.literal('github'),
      productionBranch: z.string().min(1),
      projectId: z.string().min(1),
      projectName: z.string().min(1),
      repository: z.string().regex(/^[^/]+\/[^/]+$/),
      teamId: z.string().min(1).optional(),
      userId: z.string().min(1),
    })
    .strict(),
  'orbitype-api': z
    .object({
      authenticated: z.literal(true),
      baseUrlHost: z.string().min(1),
      externalResourceId: z.string().min(1),
      readOnlyProbe: z.literal('select_1'),
    })
    .strict(),
} as const satisfies Record<IntegrationKind, z.ZodType>;

const parseEvidence = (
  kind: IntegrationKind,
  evidence: VerificationEvidence,
): VerificationEvidence => {
  const result = evidenceSchemas[kind].safeParse(evidence);
  if (!result.success) {
    throw new DomainError(
      'internal_error',
      'Provider verification returned non-allowlisted evidence.',
    );
  }
  return result.data;
};

export type CredentialVerifierInput = Readonly<{
  credential: CredentialForVerification;
  masterKey: Uint8Array;
  signal: AbortSignal;
}>;

export interface CredentialVerifier {
  readonly kinds: readonly IntegrationKind[];
  verify(input: CredentialVerifierInput): Promise<VerificationEvidence>;
}

export interface CredentialVerificationRepository {
  getCredential(
    credentialId: string,
  ): Promise<CredentialForVerification | undefined>;
  listCredentialIds(): Promise<string[]>;
  recordFailure(
    input: Readonly<{
      category: ErrorCategory;
      checkedAt: Date;
      credentialId: string;
      permanent: boolean;
    }>,
  ): Promise<void>;
  recordSuccess(
    input: Readonly<{
      checkedAt: Date;
      credentialId: string;
      evidence: VerificationEvidence;
    }>,
  ): Promise<void>;
}

export const createDatabaseCredentialVerificationRepository = (
  db: ScopedDatabase,
): CredentialVerificationRepository => ({
  getCredential: (credentialId) =>
    getCredentialForVerification(db, credentialId),
  listCredentialIds: () => listCredentialIdsForVerification(db),
  recordFailure: (input) => recordCredentialVerificationFailure(db, input),
  recordSuccess: (input) => recordCredentialVerificationSuccess(db, input),
});

export type CredentialVerificationResult = Readonly<{
  checkedAt: string;
  credentialId: string;
  errorCategory?: ErrorCategory;
  errorDetail?: string;
  evidence?: VerificationEvidence;
  kind: IntegrationKind;
  outcome: 'success' | 'failed';
}>;

const permanentCategories = new Set<ErrorCategory>([
  'authentication_error',
  'authorization_error',
  'conflict_error',
  'policy_denied',
  'provider_final',
  'validation_error',
]);

const normalizeError = (error: unknown): DomainError =>
  error instanceof DomainError
    ? error
    : new DomainError(
        'internal_error',
        'Credential verification failed internally.',
      );

export class CredentialVerificationService {
  private readonly verifierByKind = new Map<
    IntegrationKind,
    CredentialVerifier
  >();

  public constructor(
    private readonly repository: CredentialVerificationRepository,
    verifiers: readonly CredentialVerifier[],
    private readonly options: Readonly<{
      clock?: Clock;
      timeoutMs?: number;
    }> = {},
  ) {
    for (const verifier of verifiers) {
      for (const kind of verifier.kinds) {
        if (this.verifierByKind.has(kind)) {
          throw new Error(`Duplicate credential verifier for ${kind}.`);
        }
        this.verifierByKind.set(kind, verifier);
      }
    }
  }

  public async verify(
    credentialId: string,
    masterKey: Uint8Array,
  ): Promise<CredentialVerificationResult> {
    const credential = await this.repository.getCredential(credentialId);
    if (credential === undefined) {
      throw new DomainError(
        'credential_unavailable',
        'Credential was not found.',
      );
    }
    if (credential.status === 'revoked' || credential.status === 'superseded') {
      throw new DomainError(
        'credential_unavailable',
        'Credential is unavailable for verification.',
      );
    }

    const checkedAt = (this.options.clock ?? systemClock).now();
    const verifier = this.verifierByKind.get(credential.kind);
    if (verifier === undefined) {
      const error = new DomainError(
        'credential_unavailable',
        `No verifier is enabled for ${credential.kind}.`,
      );
      await this.repository.recordFailure({
        category: error.category,
        checkedAt,
        credentialId,
        permanent: false,
      });
      return {
        checkedAt: checkedAt.toISOString(),
        credentialId,
        errorCategory: error.category,
        kind: credential.kind,
        outcome: 'failed',
      };
    }

    let evidence: VerificationEvidence;
    try {
      evidence = parseEvidence(
        credential.kind,
        await verifier.verify({
          credential,
          masterKey,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        }),
      );
    } catch (cause) {
      const error = normalizeError(cause);
      await this.repository.recordFailure({
        category: error.category,
        checkedAt,
        credentialId,
        permanent: permanentCategories.has(error.category),
      });
      return {
        checkedAt: checkedAt.toISOString(),
        credentialId,
        errorCategory: error.category,
        errorDetail: error.message.slice(0, 500),
        kind: credential.kind,
        outcome: 'failed',
      };
    }

    try {
      await this.repository.recordSuccess({
        checkedAt,
        credentialId,
        evidence,
      });
    } catch (cause) {
      const error = normalizeError(cause);
      if (error.category === 'credential_unavailable') throw error;
      await this.repository.recordFailure({
        category: error.category,
        checkedAt,
        credentialId,
        permanent: permanentCategories.has(error.category),
      });
      return {
        checkedAt: checkedAt.toISOString(),
        credentialId,
        errorCategory: error.category,
        errorDetail: error.message.slice(0, 500),
        kind: credential.kind,
        outcome: 'failed',
      };
    }
    return {
      checkedAt: checkedAt.toISOString(),
      credentialId,
      evidence,
      kind: credential.kind,
      outcome: 'success',
    };
  }

  public async verifyAll(
    masterKey: Uint8Array,
  ): Promise<CredentialVerificationResult[]> {
    const credentialIds = await this.repository.listCredentialIds();
    const results: CredentialVerificationResult[] = [];
    for (const credentialId of credentialIds) {
      results.push(await this.verify(credentialId, masterKey));
    }
    return results;
  }
}
