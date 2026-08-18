import type { DeploymentPort } from '@binflow/blog';
import { webbinPilotBinding } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';
import { z } from 'zod';

const secretSchema = z.object({ token: z.string().min(1) }).strict();
const connectionConfigurationSchema = z
  .object({
    expectedProductionBranch: z.string().min(1),
    expectedRepository: z.string().regex(/^[^/]+\/[^/]+$/),
    projectId: z.string().min(1),
    teamId: z.string().min(1).optional(),
  })
  .strict();
const userSchema = z.object({
  user: z.object({ id: z.string().min(1) }),
});
const projectSchema = z.object({
  accountId: z.string().min(1),
  id: z.string().min(1),
  link: z
    .object({
      productionBranch: z.string().min(1),
      org: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      type: z.string().min(1),
    })
    .nullable(),
  name: z.string().min(1),
});

const mapHttpError = (
  status: number,
  operation: 'identity' | 'project',
): DomainError => {
  if (status === 401) {
    return new DomainError(
      'authentication_error',
      'Vercel rejected the access token.',
    );
  }
  if (status === 403) {
    return new DomainError(
      operation === 'identity' ? 'authentication_error' : 'authorization_error',
      operation === 'identity'
        ? 'Vercel rejected the access token.'
        : 'Vercel denied access to the configured project.',
    );
  }
  if (status === 404) {
    return new DomainError(
      'policy_denied',
      'The configured Vercel project was not found.',
    );
  }
  if (status === 429 || status >= 500) {
    return new DomainError(
      'provider_retryable',
      'Vercel is temporarily unavailable.',
    );
  }
  return new DomainError(
    'provider_final',
    'Vercel returned an unexpected response.',
  );
};

const readJson = async (
  fetch: typeof globalThis.fetch,
  url: URL,
  token: string,
  signal: AbortSignal,
  operation: 'identity' | 'project',
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      method: 'GET',
      signal,
    });
  } catch {
    throw new DomainError('provider_retryable', 'Vercel could not be reached.');
  }
  if (!response.ok) throw mapHttpError(response.status, operation);
  try {
    return await response.json();
  } catch {
    throw new DomainError('provider_final', 'Vercel returned invalid JSON.');
  }
};

export const createVercelCredentialVerifier = (
  options: Readonly<{
    apiBaseUrl?: string;
    fetch?: typeof globalThis.fetch;
  }> = {},
): CredentialVerifier => ({
  kinds: ['vercel'],
  async verify(input: CredentialVerifierInput): Promise<VerificationEvidence> {
    if (
      input.credential.ownerScope !== 'project' ||
      input.credential.projectId === undefined ||
      input.credential.tenantId === undefined
    ) {
      throw new DomainError(
        'policy_denied',
        'Vercel credentials must be project-scoped.',
      );
    }
    let configuration: z.infer<typeof connectionConfigurationSchema>;
    try {
      configuration = connectionConfigurationSchema.parse(
        input.credential.connection?.configuration,
      );
    } catch {
      throw new DomainError(
        'validation_error',
        'Vercel credential configuration is invalid.',
      );
    }
    if (input.credential.connection?.projectId === undefined) {
      throw new DomainError(
        'validation_error',
        'Vercel credential is missing its project binding.',
      );
    }
    if (
      configuration.expectedRepository !== webbinPilotBinding.repository ||
      configuration.expectedProductionBranch !==
        webbinPilotBinding.productionBranch
    ) {
      throw new DomainError(
        'policy_denied',
        'Vercel project binding exceeds the immutable Webbin pilot policy.',
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
      } catch {
        throw new DomainError(
          'validation_error',
          'Vercel credential payload is invalid.',
        );
      }

      const fetch = options.fetch ?? globalThis.fetch;
      const baseUrl = options.apiBaseUrl ?? 'https://api.vercel.com';
      const userUrl = new URL('/v2/user', baseUrl);
      const projectUrl = new URL(
        `/v9/projects/${encodeURIComponent(configuration.projectId)}`,
        baseUrl,
      );
      if (configuration.teamId !== undefined) {
        projectUrl.searchParams.set('teamId', configuration.teamId);
      }
      let user: z.infer<typeof userSchema>;
      let project: z.infer<typeof projectSchema>;
      try {
        user = userSchema.parse(
          await readJson(
            fetch,
            userUrl,
            secret.token,
            input.signal,
            'identity',
          ),
        );
        project = projectSchema.parse(
          await readJson(
            fetch,
            projectUrl,
            secret.token,
            input.signal,
            'project',
          ),
        );
      } catch (error) {
        if (error instanceof DomainError) throw error;
        if (error instanceof z.ZodError) {
          throw new DomainError(
            'provider_final',
            'Vercel returned an invalid identity or project response.',
          );
        }
        throw new DomainError(
          'provider_retryable',
          'Vercel verification could not be completed.',
        );
      }

      const repository =
        project.link?.org === undefined || project.link.repo === undefined
          ? undefined
          : `${project.link.org}/${project.link.repo}`;
      if (
        project.id !== configuration.projectId ||
        (configuration.teamId !== undefined &&
          project.accountId !== configuration.teamId) ||
        (configuration.teamId === undefined &&
          project.accountId !== user.user.id) ||
        project.link?.type !== 'github' ||
        repository?.toLowerCase() !==
          configuration.expectedRepository.toLowerCase() ||
        project.link.productionBranch !== configuration.expectedProductionBranch
      ) {
        throw new DomainError(
          'policy_denied',
          'Vercel project state does not match the Webbin contract.',
        );
      }

      return {
        accountId: project.accountId,
        externalResourceId: project.id,
        gitProvider: project.link.type,
        productionBranch: project.link.productionBranch,
        projectId: project.id,
        projectName: project.name,
        repository,
        ...(configuration.teamId === undefined
          ? {}
          : { teamId: configuration.teamId }),
        userId: user.user.id,
      };
    } finally {
      plaintext.fill(0);
    }
  },
});

const deploymentListSchema = z.object({
  deployments: z.array(
    z.object({
      createdAt: z.number().int().nonnegative(),
      meta: z.record(z.string(), z.unknown()).optional(),
      name: z.string().min(1),
      readyState: z.string().min(1),
      target: z.string().nullable().optional(),
      uid: z.string().min(1),
      url: z.string().min(1),
    }),
  ),
});

export const createVercelDeploymentPort = (
  input: Readonly<{
    apiBaseUrl?: string;
    credential: CredentialVerifierInput['credential'];
    fetch?: typeof globalThis.fetch;
    masterKey: Buffer;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }>,
): DeploymentPort => {
  if (
    input.credential.kind !== 'vercel' ||
    input.credential.status !== 'active'
  )
    throw new DomainError(
      'credential_unavailable',
      'Active Vercel credential is required.',
    );
  const configuration = connectionConfigurationSchema.parse(
    input.credential.connection?.configuration,
  );
  const fetch = input.fetch ?? globalThis.fetch;
  const baseUrl = input.apiBaseUrl ?? 'https://api.vercel.com';
  const sleep = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  const wait = async (
    sha: string,
    environment: 'preview' | 'production',
    routes: readonly string[],
  ) => {
    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      const secret = secretSchema.parse(JSON.parse(plaintext.toString('utf8')));
      const deadline = Date.now() + (input.timeoutMs ?? 10 * 60 * 1_000);
      do {
        const url = new URL('/v6/deployments', baseUrl);
        url.searchParams.set('projectId', configuration.projectId);
        url.searchParams.set('limit', '20');
        if (environment === 'production')
          url.searchParams.set('target', 'production');
        if (configuration.teamId !== undefined)
          url.searchParams.set('teamId', configuration.teamId);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${secret.token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw mapHttpError(response.status, 'project');
        const deployments = deploymentListSchema.parse(
          await response.json(),
        ).deployments;
        const deployment = deployments.find(
          (candidate) =>
            candidate.meta?.githubCommitSha === sha &&
            (environment === 'production'
              ? candidate.target === 'production'
              : candidate.target !== 'production'),
        );
        if (
          deployment?.readyState === 'ERROR' ||
          deployment?.readyState === 'CANCELED'
        )
          throw new DomainError('provider_final', 'Vercel deployment failed.');
        if (deployment?.readyState === 'READY') {
          const origin = `https://${deployment.url}`;
          return {
            deploymentId: deployment.uid,
            environment,
            readyAt: new Date(deployment.createdAt).toISOString(),
            sha,
            urls: Object.fromEntries(
              routes.map((route) => [route, `${origin}${route}`]),
            ),
          } as const;
        }
        await sleep(input.pollIntervalMs ?? 5_000);
      } while (Date.now() < deadline);
      throw new DomainError(
        'provider_retryable',
        'Timed out waiting for Vercel deployment.',
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof z.ZodError)
        throw new DomainError(
          'provider_final',
          'Vercel returned invalid deployment evidence.',
        );
      throw new DomainError(
        'provider_retryable',
        'Vercel deployment lookup failed.',
      );
    } finally {
      plaintext.fill(0);
    }
  };

  return {
    async waitForPreview(request) {
      return wait(request.headCommitSha, 'preview', request.routes);
    },
    async waitForProduction(request) {
      return wait(request.mergeCommitSha, 'production', request.routes);
    },
  };
};
