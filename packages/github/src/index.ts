import { createHash, createPrivateKey } from 'node:crypto';

import { createAppAuth } from '@octokit/auth-app';
import { request as octokitRequest } from '@octokit/request';
import { z } from 'zod';

import { webbinPilotBinding } from '@binflow/contracts';
import type {
  CatalogItem,
  ContentCatalogPort,
  RepositoryPublicationPort,
} from '@binflow/blog';
import type { ProjectManifest } from '@binflow/contracts';
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
      { status: String(status) },
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
              if (auditFailure === undefined && repositoryId === undefined)
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
              if (repositoryFailure === undefined && repository === undefined)
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

const publicationPermissions = {
  checks: 'read',
  contents: 'write',
  deployments: 'read',
  metadata: 'read',
  pull_requests: 'write',
  statuses: 'read',
} as const;

const pullRequestSchema = z.object({
  head: z.object({ sha: z.string().min(7) }),
  html_url: z.url(),
  merged: z.boolean().optional(),
  merge_commit_sha: z.string().nullable().optional(),
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
});
const referenceSchema = z.object({
  object: z.object({ sha: z.string().min(7) }),
});
const contentWriteSchema = z.object({
  commit: z.object({ sha: z.string().min(7) }),
});
const mergeSchema = z.object({
  merged: z.boolean(),
  sha: z.string().min(7).optional(),
});
const pullFileSchema = z.object({ filename: z.string().min(1) });
const combinedStatusSchema = z.object({
  state: z.enum(['success', 'pending', 'failure', 'error']),
});

export const createGitHubRepositoryPublicationPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    credential: CredentialVerifierInput['credential'];
    fetch?: typeof globalThis.fetch;
    installationId: string;
    masterKey: Buffer;
    repositoryId: string;
  }>,
): RepositoryPublicationPort => {
  if (
    input.credential.kind !== 'github-app' ||
    input.credential.status !== 'active'
  )
    throw new DomainError(
      'credential_unavailable',
      'Active GitHub App credential is required.',
    );
  const configuration = configurationSchema.parse(
    input.credential.configuration,
  );
  const connection = connectionConfigurationSchema.parse(
    input.credential.connection?.configuration,
  );
  if (
    connection.expectedRepository !== webbinPilotBinding.repository ||
    connection.defaultBranch !== webbinPilotBinding.productionBranch
  )
    throw new DomainError(
      'policy_denied',
      'GitHub publication binding is outside Webbin.',
    );
  const [owner, repo] = splitRepository(connection.expectedRepository);
  const repositoryId = Number(input.repositoryId);
  const installationId = Number(input.installationId);
  if (
    !Number.isSafeInteger(repositoryId) ||
    !Number.isSafeInteger(installationId)
  )
    throw new DomainError(
      'validation_error',
      'GitHub publication IDs are invalid.',
    );

  const withToken = async <Value>(
    operation: (
      requester: typeof octokitRequest,
      token: string,
    ) => Promise<Value>,
  ): Promise<Value> => {
    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    let token: string | undefined;
    let failure: unknown;
    let result: Value | undefined;
    try {
      const secret = secretSchema.parse(JSON.parse(plaintext.toString('utf8')));
      const requester = octokitRequest.defaults({
        ...(input.apiBaseUrl === undefined
          ? {}
          : { baseUrl: input.apiBaseUrl }),
        request: input.fetch === undefined ? {} : { fetch: input.fetch },
      });
      const auth = createAppAuth({
        appId: configuration.appId,
        clientId: configuration.clientId,
        privateKey: secret.privateKey,
        request: requester,
      });
      const authentication = await auth({
        installationId,
        permissions: publicationPermissions,
        refresh: true,
        repositoryIds: [repositoryId],
        type: 'installation',
      });
      token = authentication.token;
      if (
        !exactPermissions(authentication.permissions, publicationPermissions) ||
        authentication.repositoryIds?.length !== 1 ||
        Number(authentication.repositoryIds[0]) !== repositoryId
      )
        throw new DomainError(
          'policy_denied',
          'GitHub publication token was not exactly downscoped.',
        );
      result = await operation(requester, token);
    } catch (error) {
      failure = error;
    } finally {
      plaintext.fill(0);
      if (token !== undefined) {
        try {
          await octokitRequest('DELETE /installation/token', {
            ...(input.apiBaseUrl === undefined
              ? {}
              : { baseUrl: input.apiBaseUrl }),
            headers: { authorization: `Bearer ${token}` },
            request: {
              ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
              signal: AbortSignal.timeout(5_000),
            },
          });
        } catch {
          if (failure === undefined && result === undefined)
            failure = new DomainError(
              'provider_retryable',
              'GitHub publication token cleanup failed.',
            );
        }
      }
    }
    if (failure !== undefined)
      throw failure instanceof DomainError ? failure : mapGitHubError(failure);
    return result as Value;
  };

  const authorization = (token: string) => ({
    authorization: `Bearer ${token}`,
  });
  const listPullFiles = async (
    requester: typeof octokitRequest,
    token: string,
    pullNumber: number,
  ): Promise<string[]> => {
    const response = await requester(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
      {
        headers: authorization(token),
        owner,
        per_page: 100,
        pull_number: pullNumber,
        repo,
      },
    );
    return z
      .array(pullFileSchema)
      .parse(response.data)
      .map((file) => file.filename);
  };

  const findExistingPull = async (
    requester: typeof octokitRequest,
    token: string,
    branch: string,
  ) => {
    const response = await requester('GET /repos/{owner}/{repo}/pulls', {
      base: webbinPilotBinding.productionBranch,
      head: `${owner}:${branch}`,
      headers: authorization(token),
      owner,
      repo,
      state: 'all',
    });
    return z.array(pullRequestSchema).parse(response.data)[0];
  };

  return {
    async createDraft(draft) {
      return withToken(async (requester, token) => {
        const files = draft.files ?? [];
        const deletions = draft.deletions ?? [];
        if (files.length === 0 && deletions.length === 0)
          throw new DomainError(
            'validation_error',
            'Draft requires files or deletions.',
          );
        const expectedFiles = [
          ...files.map((file) => file.path),
          ...deletions,
        ].sort();
        const isDeletionDraft = deletions.length > 0;
        const existing = await findExistingPull(requester, token, draft.branch);
        if (existing !== undefined) {
          const prFiles = (
            await listPullFiles(requester, token, existing.number)
          ).sort();
          if (JSON.stringify(prFiles) !== JSON.stringify(expectedFiles))
            throw new DomainError(
              'conflict_error',
              'Existing request PR has an unexpected file set.',
            );
          let headSha = existing.head.sha;
          for (const file of files) {
            const current = await requester(
              'GET /repos/{owner}/{repo}/contents/{path}',
              {
                headers: authorization(token),
                owner,
                path: file.path,
                ref: draft.branch,
                repo,
              },
            );
            const currentSha = z
              .object({ sha: z.string().min(1) })
              .parse(current.data).sha;
            const response = await requester(
              'PUT /repos/{owner}/{repo}/contents/{path}',
              {
                branch: draft.branch,
                content: Buffer.from(file.bytes).toString('base64'),
                headers: authorization(token),
                message: `Update bilingual blog draft for ${draft.requestId}`,
                owner,
                path: file.path,
                repo,
                sha: currentSha,
              },
            );
            headSha = contentWriteSchema.parse(response.data).commit.sha;
          }
          for (const path of deletions) {
            const current = await requester(
              'GET /repos/{owner}/{repo}/contents/{path}',
              {
                headers: authorization(token),
                owner,
                path,
                ref: draft.branch,
                repo,
              },
            );
            const currentSha = z
              .object({ sha: z.string().min(1) })
              .parse(current.data).sha;
            const response = await requester(
              'DELETE /repos/{owner}/{repo}/contents/{path}',
              {
                branch: draft.branch,
                headers: authorization(token),
                message: `Delete blog content for ${draft.requestId}`,
                owner,
                path,
                repo,
                sha: currentSha,
              },
            );
            headSha = contentWriteSchema.parse(response.data).commit.sha;
          }
          if (headSha === existing.head.sha)
            throw new DomainError(
              'conflict_error',
              'Draft file update did not produce a new commit.',
            );
          return {
            baseCommitSha: 'reconciled',
            branch: draft.branch,
            files: prFiles,
            headCommitSha: headSha,
            pullRequestId: String(existing.number),
            pullRequestUrl: existing.html_url,
          };
        }
        const baseResponse = await requester(
          'GET /repos/{owner}/{repo}/git/ref/{ref}',
          {
            headers: authorization(token),
            owner,
            ref: `heads/${webbinPilotBinding.productionBranch}`,
            repo,
          },
        );
        const baseSha = referenceSchema.parse(baseResponse.data).object.sha;
        await requester('POST /repos/{owner}/{repo}/git/refs', {
          headers: authorization(token),
          owner,
          ref: `refs/heads/${draft.branch}`,
          repo,
          sha: baseSha,
        });
        let headSha = baseSha;
        const readPathSha = async (path: string): Promise<string | null> => {
          try {
            const current = await requester(
              'GET /repos/{owner}/{repo}/contents/{path}',
              {
                headers: authorization(token),
                owner,
                path,
                ref: draft.branch,
                repo,
              },
            );
            return z.object({ sha: z.string().min(1) }).parse(current.data).sha;
          } catch (error) {
            if (
              error instanceof Error &&
              'status' in error &&
              (error as { status?: number }).status === 404
            )
              return null;
            throw error;
          }
        };
        for (const file of files) {
          const existingSha = await readPathSha(file.path);
          const response = await requester(
            'PUT /repos/{owner}/{repo}/contents/{path}',
            {
              branch: draft.branch,
              content: Buffer.from(file.bytes).toString('base64'),
              headers: authorization(token),
              message:
                existingSha === null
                  ? `Add bilingual blog draft for ${draft.requestId}`
                  : `Update blog draft artifacts for ${draft.requestId}`,
              owner,
              path: file.path,
              repo,
              ...(existingSha === null ? {} : { sha: existingSha }),
            },
          );
          headSha = contentWriteSchema.parse(response.data).commit.sha;
        }
        const appliedDeletions: string[] = [];
        for (const path of deletions) {
          const currentSha = await readPathSha(path);
          if (currentSha === null) continue;
          const response = await requester(
            'DELETE /repos/{owner}/{repo}/contents/{path}',
            {
              branch: draft.branch,
              headers: authorization(token),
              message: `Delete blog content for ${draft.requestId}`,
              owner,
              path,
              repo,
              sha: currentSha,
            },
          );
          headSha = contentWriteSchema.parse(response.data).commit.sha;
          appliedDeletions.push(path);
        }
        const appliedFiles = [
          ...files.map((file) => file.path),
          ...appliedDeletions,
        ].sort();
        if (
          isDeletionDraft &&
          appliedDeletions.length === 0 &&
          files.length === 0
        )
          throw new DomainError(
            'validation_error',
            'Deletion draft found no removable repository paths.',
          );
        const pullResponse = await requester(
          'POST /repos/{owner}/{repo}/pulls',
          {
            base: webbinPilotBinding.productionBranch,
            body: `Binflow request ${draft.requestId}. Preview and approval are required before merge.`,
            head: draft.branch,
            headers: authorization(token),
            owner,
            repo,
            title: isDeletionDraft
              ? `Delete blog: ${draft.slug}`
              : `Blog draft: ${draft.slug}`,
          },
        );
        const pull = pullRequestSchema.parse(pullResponse.data);
        if (pull.head.sha !== headSha)
          throw new DomainError(
            'provider_final',
            'GitHub PR head does not match the final artifact commit.',
          );
        return {
          baseCommitSha: baseSha,
          branch: draft.branch,
          files: appliedFiles,
          headCommitSha: headSha,
          pullRequestId: String(pull.number),
          pullRequestUrl: pull.html_url,
        };
      });
    },
    async readFileAtRef(input) {
      return withToken(async (requester, token) => {
        try {
          const response = await requester(
            'GET /repos/{owner}/{repo}/contents/{path}',
            {
              headers: authorization(token),
              owner,
              path: input.path,
              ref: input.ref,
              repo,
            },
          );
          const payload = z
            .object({
              content: z.string().min(1),
              encoding: z.literal('base64'),
            })
            .parse(response.data);
          return Buffer.from(payload.content, 'base64');
        } catch (error) {
          if (
            error instanceof Error &&
            'status' in error &&
            (error as { status?: number }).status === 404
          )
            return null;
          throw error;
        }
      });
    },
    async revalidate(revalidation) {
      await withToken(async (requester, token) => {
        const pullNumber = Number(revalidation.pullRequestId);
        const response = await requester(
          'GET /repos/{owner}/{repo}/pulls/{pull_number}',
          {
            headers: authorization(token),
            owner,
            pull_number: pullNumber,
            repo,
          },
        );
        const pull = pullRequestSchema.parse(response.data);
        const files = (
          await listPullFiles(requester, token, pullNumber)
        ).sort();
        if (
          pull.head.sha !== revalidation.expectedHeadSha ||
          JSON.stringify(files) !==
            JSON.stringify([...revalidation.expectedFiles].sort())
        )
          throw new DomainError(
            'conflict_error',
            'GitHub PR changed after preview approval.',
          );
        if (pull.merged === true) return;
        if (pull.state !== 'open')
          throw new DomainError(
            'conflict_error',
            'GitHub PR changed after preview approval.',
          );
        if (revalidation.requireCommitStatus === false) return;
        const status = combinedStatusSchema.parse(
          (
            await requester('GET /repos/{owner}/{repo}/commits/{ref}/status', {
              headers: authorization(token),
              owner,
              ref: revalidation.expectedHeadSha,
              repo,
            })
          ).data,
        );
        if (status.state !== 'success')
          throw new DomainError(
            'conflict_error',
            'GitHub checks are not successful for the approved commit.',
          );
      });
    },
    async merge(merge) {
      return withToken(async (requester, token) => {
        const pullNumber = Number(merge.pullRequestId);
        const before = pullRequestSchema.parse(
          (
            await requester('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
              headers: authorization(token),
              owner,
              pull_number: pullNumber,
              repo,
            })
          ).data,
        );
        if (
          before.merged === true &&
          before.merge_commit_sha !== null &&
          before.merge_commit_sha !== undefined
        )
          return { mergeCommitSha: before.merge_commit_sha };
        if (before.head.sha !== merge.expectedHeadSha)
          throw new DomainError(
            'conflict_error',
            'GitHub PR head changed before merge.',
          );
        const response = await requester(
          'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
          {
            headers: authorization(token),
            merge_method: 'squash',
            owner,
            pull_number: pullNumber,
            repo,
            sha: merge.expectedHeadSha,
          },
        );
        const result = mergeSchema.parse(response.data);
        if (!result.merged || result.sha === undefined)
          throw new DomainError(
            'conflict_error',
            'GitHub did not merge the approved PR.',
          );
        return { mergeCommitSha: result.sha };
      });
    },
  };
};

const treeSchema = z.object({
  sha: z.string().min(7),
  tree: z.array(
    z.object({
      path: z.string().min(1),
      sha: z.string().min(7),
      type: z.string().min(1),
    }),
  ),
});
const blobSchema = z.object({
  content: z.string().min(1),
  encoding: z.literal('base64'),
  sha: z.string().min(7),
});

const frontmatterValue = (
  source: string,
  field: string,
): string | undefined => {
  const match = new RegExp(`^${field}:\\s*(.+)$`, 'mu')
    .exec(source)?.[1]
    ?.trim();
  if (match === undefined) return undefined;
  if (match.startsWith('"') && match.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(match);
      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return match.replace(/^['"]|['"]$/gu, '');
};

export type GitHubCatalogContentKind = 'blog' | 'portfolio';

type GitHubCatalogDirectory = Readonly<{
  kind: GitHubCatalogContentKind;
  locale: 'en' | 'es';
  prefix: string;
}>;

export const resolveGitHubCatalogDirectories = (
  manifest: ProjectManifest,
  contentKinds: readonly GitHubCatalogContentKind[],
): readonly GitHubCatalogDirectory[] => [
  ...(contentKinds.includes('blog')
    ? Object.entries(manifest.content.collections).flatMap(
        ([locale, collection]) =>
          collection === undefined
            ? []
            : [
                {
                  kind: 'blog' as const,
                  locale: locale as 'en' | 'es',
                  prefix: `${collection.directory}/`,
                },
              ],
      )
    : []),
  ...(contentKinds.includes('portfolio')
    ? Object.entries(manifest.content.portfolio?.collections ?? {}).flatMap(
        ([locale, collection]) =>
          collection === undefined
            ? []
            : [
                {
                  kind: 'portfolio' as const,
                  locale: locale as 'en' | 'es',
                  prefix: `${collection.directory}/`,
                },
              ],
      )
    : []),
];

export const createGitHubContentCatalogPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    contentKinds: readonly GitHubCatalogContentKind[];
    credential: CredentialVerifierInput['credential'];
    fetch?: typeof globalThis.fetch;
    installationId: string;
    masterKey: Buffer;
    repositoryId: string;
  }>,
): ContentCatalogPort => {
  const contentKinds = input.contentKinds;
  if (contentKinds.length === 0)
    throw new DomainError(
      'validation_error',
      'GitHub catalog sync requires an explicit non-empty contentKinds scope.',
      { code: 'catalog_scope_required' },
    );
  const configuration = configurationSchema.parse(
    input.credential.configuration,
  );
  const connection = connectionConfigurationSchema.parse(
    input.credential.connection?.configuration,
  );
  const [owner, repo] = splitRepository(connection.expectedRepository);
  const installationId = Number(input.installationId);
  const repositoryId = Number(input.repositoryId);
  if (
    input.credential.kind !== 'github-app' ||
    input.credential.status !== 'active' ||
    !Number.isSafeInteger(installationId) ||
    !Number.isSafeInteger(repositoryId)
  )
    throw new DomainError(
      'credential_unavailable',
      'Verified GitHub catalog credential is required.',
    );

  return {
    async sync(syncInput: Readonly<{ manifest: ProjectManifest }>) {
      const manifest = syncInput.manifest;
      const catalogDirectories = resolveGitHubCatalogDirectories(
        manifest,
        contentKinds,
      );
      const plaintext = decryptSecret(
        input.credential.envelope,
        input.masterKey,
        input.credential.secretContext,
      );
      let token: string | undefined;
      let requester: typeof octokitRequest | undefined;
      let failure: unknown;
      let result: Awaited<ReturnType<ContentCatalogPort['sync']>> | undefined;
      try {
        const secret = secretSchema.parse(
          JSON.parse(plaintext.toString('utf8')),
        );
        requester = octokitRequest.defaults({
          ...(input.apiBaseUrl === undefined
            ? {}
            : { baseUrl: input.apiBaseUrl }),
          request: input.fetch === undefined ? {} : { fetch: input.fetch },
        });
        const auth = createAppAuth({
          appId: configuration.appId,
          clientId: configuration.clientId,
          privateKey: secret.privateKey,
          request: requester,
        });
        const authentication = await auth({
          installationId,
          permissions: repositoryReadPermissions,
          refresh: true,
          repositoryIds: [repositoryId],
          type: 'installation',
        });
        token = authentication.token;
        if (
          !exactPermissions(
            authentication.permissions,
            repositoryReadPermissions,
          ) ||
          authentication.repositoryIds?.length !== 1 ||
          Number(authentication.repositoryIds[0]) !== repositoryId
        )
          throw new DomainError(
            'policy_denied',
            'GitHub catalog token was not exactly downscoped.',
          );
        const headers = { authorization: `Bearer ${token}` };
        const tree = treeSchema.parse(
          (
            await requester('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
              headers,
              owner,
              recursive: '1',
              repo,
              tree_sha: connection.defaultBranch,
            })
          ).data,
        );
        const entries = tree.tree.filter(
          (entry) =>
            entry.type === 'blob' &&
            entry.path.endsWith('.md') &&
            !entry.path.split('/').at(-1)?.startsWith('_') &&
            catalogDirectories.some((directory) =>
              entry.path.startsWith(directory.prefix),
            ),
        );
        const items: CatalogItem[] = [];
        for (const entry of entries) {
          const directory = catalogDirectories.find((candidate) =>
            entry.path.startsWith(candidate.prefix),
          );
          if (directory === undefined) continue;
          const blob = blobSchema.parse(
            (
              await requester(
                'GET /repos/{owner}/{repo}/git/blobs/{file_sha}',
                {
                  file_sha: entry.sha,
                  headers,
                  owner,
                  repo,
                },
              )
            ).data,
          );
          const source = Buffer.from(
            blob.content.replaceAll(/\s/gu, ''),
            'base64',
          ).toString('utf8');
          const title =
            directory.kind === 'portfolio'
              ? frontmatterValue(source, 'descriptor')
              : frontmatterValue(source, 'titulo');
          const category =
            directory.kind === 'portfolio'
              ? frontmatterValue(source, 'industria')
              : frontmatterValue(source, 'categoria');
          if (title === undefined || category === undefined)
            throw new DomainError(
              'provider_final',
              `Webbin catalog item ${entry.path} has invalid frontmatter.`,
            );
          items.push({
            category,
            contentHash: createHash('sha256').update(source).digest('hex'),
            locale: directory.locale,
            slug:
              entry.path.split('/').at(-1)?.replace(/\.md$/u, '') ?? entry.sha,
            sourceId: entry.path,
            sourceRevision: tree.sha,
            title,
          });
        }
        result = { items, revision: tree.sha };
      } catch (error) {
        failure = error;
      } finally {
        plaintext.fill(0);
        if (token !== undefined && requester !== undefined) {
          try {
            await requester('DELETE /installation/token', {
              headers: { authorization: `Bearer ${token}` },
              request: { signal: AbortSignal.timeout(5_000) },
            });
          } catch {
            if (failure === undefined && result === undefined)
              failure = new DomainError(
                'provider_retryable',
                'GitHub catalog token cleanup failed.',
              );
          }
        }
      }
      if (failure !== undefined)
        throw failure instanceof DomainError
          ? failure
          : mapGitHubError(failure);
      if (result === undefined)
        throw new DomainError(
          'internal_error',
          'GitHub catalog operation returned no result.',
        );
      return result;
    },
  };
};
