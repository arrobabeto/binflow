import { createHash, createPrivateKey } from 'node:crypto';

import { createAppAuth } from '@octokit/auth-app';
import { request as octokitRequest } from '@octokit/request';
import { z } from 'zod';

import { webbinPilotBinding } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';

const registrationPermissions = {
  administration: 'write',
  checks: 'read',
  contents: 'write',
  deployments: 'read',
  metadata: 'read',
  pull_requests: 'write',
  statuses: 'read',
  workflows: 'write',
} as const;

const auditPermissions = { metadata: 'read' } as const;
const repositoryReadPermissions = {
  contents: 'read',
  metadata: 'read',
} as const;

const configurationSchema = z
  .object({
    appId: z.string().regex(/^\d+$/),
    clientId: z.string().min(1),
  })
  .strict();
const connectionConfigurationSchema = z
  .object({
    defaultBranch: z.string().min(1),
    expectedRepository: z.string().regex(/^[^/]+\/[^/]+$/),
  })
  .strict();
const secretSchema = z
  .object({
    privateKey: z.string().min(1),
    webhookSecret: z.string().min(32),
  })
  .strict();
const appSchema = z.object({
  client_id: z.string().min(1),
  id: z.number().int().positive(),
  permissions: z.record(z.string(), z.string()),
  slug: z.string().min(1),
});
const installationSchema = z.object({
  account: z.object({ login: z.string().min(1) }),
  id: z.number().int().positive(),
  permissions: z.record(z.string(), z.string()),
  repository_selection: z.enum(['all', 'selected']),
  suspended_at: z.string().nullable(),
});
const repositoriesSchema = z.object({
  repositories: z.array(
    z.object({
      full_name: z.string().min(1),
      id: z.number().int().positive(),
    }),
  ),
  total_count: z.number().int().nonnegative(),
});
const repositorySchema = z.object({
  archived: z.boolean(),
  default_branch: z.string().min(1),
  disabled: z.boolean(),
  full_name: z.string().min(1),
  id: z.number().int().positive(),
});

const stablePermissions = (permissions: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries(permissions).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

const exactPermissions = (
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean =>
  JSON.stringify(stablePermissions(actual)) ===
  JSON.stringify(stablePermissions(expected));

const mapGitHubError = (error: unknown): DomainError => {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 401) {
    return new DomainError(
      'authentication_error',
      'GitHub rejected the App credential.',
    );
  }
  if (status === 403) {
    return new DomainError(
      'authorization_error',
      'GitHub denied the verification operation.',
    );
  }
  if (status === 404) {
    return new DomainError(
      'policy_denied',
      'The configured GitHub App installation was not found.',
    );
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return new DomainError(
      'provider_retryable',
      'GitHub is temporarily unavailable.',
    );
  }
  if (status !== undefined) {
    return new DomainError(
      'provider_final',
      'GitHub returned an unexpected response.',
    );
  }
  return new DomainError(
    'provider_retryable',
    'GitHub verification could not be completed.',
  );
};

const splitRepository = (fullName: string): [string, string] => {
  const [owner, repository, ...rest] = fullName.split('/');
  if (owner === undefined || repository === undefined || rest.length > 0) {
    throw new DomainError(
      'validation_error',
      'GitHub repository configuration is invalid.',
    );
  }
  return [owner, repository];
};

export const createGitHubCredentialVerifier = (
  options: Readonly<{
    apiBaseUrl?: string;
    fetch?: typeof globalThis.fetch;
  }> = {},
): CredentialVerifier => ({
  kinds: ['github-app'],
  async verify(input: CredentialVerifierInput): Promise<VerificationEvidence> {
    let configuration: z.infer<typeof configurationSchema>;
    let connectionConfiguration: z.infer<typeof connectionConfigurationSchema>;
    try {
      configuration = configurationSchema.parse(input.credential.configuration);
      connectionConfiguration = connectionConfigurationSchema.parse(
        input.credential.connection?.configuration,
      );
    } catch {
      throw new DomainError(
        'validation_error',
        'GitHub App configuration is invalid.',
      );
    }
    if (input.credential.ownerScope !== 'platform') {
      throw new DomainError(
        'policy_denied',
        'GitHub App registration credential must be platform-scoped.',
      );
    }
    if (input.credential.connection?.projectId === undefined) {
      throw new DomainError(
        'validation_error',
        'GitHub App credential is missing its project installation binding.',
      );
    }
    if (
      connectionConfiguration.expectedRepository !==
        webbinPilotBinding.repository ||
      connectionConfiguration.defaultBranch !==
        webbinPilotBinding.productionBranch
    ) {
      throw new DomainError(
        'policy_denied',
        'GitHub project binding exceeds the immutable Webbin pilot policy.',
      );
    }

    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      let secret: z.infer<typeof secretSchema>;
      try {
        secret = secretSchema.parse(JSON.parse(plaintext.toString('utf8')));
        createPrivateKey(secret.privateKey);
      } catch {
        throw new DomainError(
          'validation_error',
          'GitHub App secret payload is invalid.',
        );
      }

      const requester = octokitRequest.defaults({
        ...(options.apiBaseUrl === undefined
          ? {}
          : { baseUrl: options.apiBaseUrl }),
        request: {
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          signal: input.signal,
        },
      });
      const auth = createAppAuth({
        appId: configuration.appId,
        clientId: configuration.clientId,
        privateKey: secret.privateKey,
        request: requester,
      });
      const [owner, repositoryName] = splitRepository(
        connectionConfiguration.expectedRepository,
      );

      try {
        const appAuthentication = await auth({ type: 'app' });
        const appResponse = await requester('GET /app', {
          headers: { authorization: `Bearer ${appAuthentication.token}` },
          request: { signal: input.signal },
        });
        const app = appSchema.parse(appResponse.data);
        if (
          String(app.id) !== configuration.appId ||
          app.client_id !== configuration.clientId
        ) {
          throw new DomainError(
            'policy_denied',
            'GitHub App identity does not match its configuration.',
          );
        }
        if (!exactPermissions(app.permissions, registrationPermissions)) {
          throw new DomainError(
            'policy_denied',
            'GitHub App registration permissions do not match the approved ceiling.',
          );
        }

        const installationResponse = await requester(
          'GET /repos/{owner}/{repo}/installation',
          {
            headers: { authorization: `Bearer ${appAuthentication.token}` },
            owner,
            repo: repositoryName,
            request: { signal: input.signal },
          },
        );
        const installation = installationSchema.parse(
          installationResponse.data,
        );
        if (installation.suspended_at !== null) {
          throw new DomainError(
            'policy_denied',
            'GitHub App installation is suspended.',
          );
        }
        if (
          installation.repository_selection !== 'selected' ||
          installation.account.login.toLowerCase() !== owner.toLowerCase() ||
          !exactPermissions(installation.permissions, registrationPermissions)
        ) {
          throw new DomainError(
            'policy_denied',
            'GitHub App installation scope does not match the approved Webbin contract.',
          );
        }

        let auditToken: string | undefined;
        let auditFailure: unknown;
        let repositoryId: number | undefined;
        try {
          const auditAuthentication = await auth({
            installationId: installation.id,
            permissions: auditPermissions,
            refresh: true,
            type: 'installation',
          });
          auditToken = auditAuthentication.token;
          if (
            !exactPermissions(auditAuthentication.permissions, auditPermissions)
          ) {
            throw new DomainError(
              'policy_denied',
              'GitHub installation audit token exceeded its permission map.',
            );
          }
          const repositoriesResponse = await requester(
            'GET /installation/repositories',
            {
              headers: { authorization: `Bearer ${auditToken}` },
              per_page: 100,
              request: { signal: input.signal },
            },
          );
          const repositories = repositoriesSchema.parse(
            repositoriesResponse.data,
          );
          if (
            repositories.total_count !== 1 ||
            repositories.repositories.length !== 1 ||
            repositories.repositories[0]?.full_name.toLowerCase() !==
              connectionConfiguration.expectedRepository.toLowerCase()
          ) {
            throw new DomainError(
              'policy_denied',
              'GitHub App installation is not restricted to the expected repository.',
            );
          }
          repositoryId = repositories.repositories[0].id;
        } catch (error) {
          auditFailure = error;
        } finally {
          if (auditToken !== undefined) {
            try {
              await requester('DELETE /installation/token', {
                headers: { authorization: `Bearer ${auditToken}` },
                request: { signal: AbortSignal.timeout(5_000) },
              });
            } catch {
              auditFailure = new DomainError(
                'provider_retryable',
                'GitHub installation audit token cleanup failed.',
              );
            }
          }
        }
        if (auditFailure !== undefined) {
          throw auditFailure instanceof Error
            ? auditFailure
            : new DomainError(
                'internal_error',
                'GitHub installation audit failed internally.',
              );
        }
        if (repositoryId === undefined) {
          throw new DomainError(
            'provider_final',
            'GitHub repository identity was not returned.',
          );
        }

        let repositoryToken: string | undefined;
        let repositoryFailure: unknown;
        let repository: z.infer<typeof repositorySchema> | undefined;
        try {
          const repositoryAuthentication = await auth({
            installationId: installation.id,
            permissions: repositoryReadPermissions,
            refresh: true,
            repositoryIds: [repositoryId],
            type: 'installation',
          });
          repositoryToken = repositoryAuthentication.token;
          if (
            !exactPermissions(
              repositoryAuthentication.permissions,
              repositoryReadPermissions,
            ) ||
            repositoryAuthentication.repositoryIds?.length !== 1 ||
            Number(repositoryAuthentication.repositoryIds[0]) !== repositoryId
          ) {
            throw new DomainError(
              'policy_denied',
              'GitHub repository token was not downscoped as requested.',
            );
          }
          const repositoryResponse = await requester(
            'GET /repos/{owner}/{repo}',
            {
              headers: { authorization: `Bearer ${repositoryToken}` },
              owner,
              repo: repositoryName,
              request: { signal: input.signal },
            },
          );
          repository = repositorySchema.parse(repositoryResponse.data);
          if (
            repository.id !== repositoryId ||
            repository.full_name.toLowerCase() !==
              connectionConfiguration.expectedRepository.toLowerCase() ||
            repository.default_branch !==
              connectionConfiguration.defaultBranch ||
            repository.archived ||
            repository.disabled
          ) {
            throw new DomainError(
              'policy_denied',
              'GitHub repository state does not match the Webbin contract.',
            );
          }
        } catch (error) {
          repositoryFailure = error;
        } finally {
          if (repositoryToken !== undefined) {
            try {
              await requester('DELETE /installation/token', {
                headers: { authorization: `Bearer ${repositoryToken}` },
                request: { signal: AbortSignal.timeout(5_000) },
              });
            } catch {
              repositoryFailure = new DomainError(
                'provider_retryable',
                'GitHub repository token cleanup failed.',
              );
            }
          }
        }
        if (repositoryFailure !== undefined) {
          throw repositoryFailure instanceof Error
            ? repositoryFailure
            : new DomainError(
                'internal_error',
                'GitHub repository verification failed internally.',
              );
        }
        if (repository === undefined) {
          throw new DomainError(
            'provider_final',
            'GitHub repository verification was incomplete.',
          );
        }

        const permissionHash = createHash('sha256')
          .update(JSON.stringify(stablePermissions(app.permissions)))
          .digest('hex');
        return {
          appId: String(app.id),
          appSlug: app.slug,
          defaultBranch: repository.default_branch,
          externalResourceId: String(installation.id),
          installationAccount: installation.account.login,
          installationId: String(installation.id),
          permissionHash,
          repository: repository.full_name,
          repositoryId: String(repository.id),
          webhookVerification: 'pending_signed_delivery',
        };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        if (error instanceof z.ZodError) {
          throw new DomainError(
            'provider_final',
            'GitHub returned an invalid verification response.',
          );
        }
        throw mapGitHubError(error);
      }
    } finally {
      plaintext.fill(0);
    }
  },
});

export const githubRegistrationPermissions = registrationPermissions;
