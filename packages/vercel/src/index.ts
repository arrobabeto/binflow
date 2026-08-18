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
