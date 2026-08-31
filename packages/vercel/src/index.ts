import type { DeploymentEvidence, DeploymentPort } from '@binflow/blog';
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
      configuration.expectedRepository === webbinPilotBinding.repository &&
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
      const mismatches: string[] = [];
      if (project.id !== configuration.projectId) {
        mismatches.push('projectId');
      }
      if (
        configuration.teamId !== undefined &&
        project.accountId !== configuration.teamId
      ) {
        mismatches.push('teamId (project.accountId must equal Team ID)');
      }
      if (
        configuration.teamId === undefined &&
        project.accountId !== user.user.id
      ) {
        mismatches.push(
          'teamId (project belongs to a team — paste Team ID, or token is from another account)',
        );
      }
      if (project.link?.type !== 'github') {
        mismatches.push('git provider (must be GitHub-linked)');
      }
      if (
        repository?.toLowerCase() !==
        configuration.expectedRepository.toLowerCase()
      ) {
        mismatches.push(
          `expectedRepository (Vercel has ${repository ?? 'none'}, form has ${configuration.expectedRepository})`,
        );
      }
      if (
        project.link?.productionBranch !==
        configuration.expectedProductionBranch
      ) {
        mismatches.push(
          `productionBranch (Vercel has ${project.link?.productionBranch ?? 'none'}, form has ${configuration.expectedProductionBranch})`,
        );
      }
      if (mismatches.length > 0) {
        throw new DomainError(
          'policy_denied',
          `Vercel project state does not match the binding: ${mismatches.join('; ')}.`,
          { code: 'vercel_binding_mismatch' },
        );
      }
      const link = project.link;
      if (
        link === null ||
        link.type !== 'github' ||
        repository === undefined
      ) {
        throw new DomainError(
          'policy_denied',
          'Vercel project is missing a GitHub production link.',
          { code: 'vercel_binding_mismatch' },
        );
      }

      return {
        accountId: project.accountId,
        externalResourceId: project.id,
        gitProvider: link.type,
        productionBranch: link.productionBranch,
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

export const isVercelAppHostname = (hostname: string): boolean =>
  hostname === 'vercel.app' || hostname.endsWith('.vercel.app');

export const isUniqueVercelDeploymentHostname = (hostname: string): boolean => {
  const suffix = '.vercel.app';
  if (!hostname.endsWith(suffix) || hostname === suffix.slice(1)) return false;
  return hostname.slice(0, -suffix.length).includes('-');
};

const originForRoutes = (hostname: string): string =>
  hostname.startsWith('https://')
    ? hostname.replace(/\/$/u, '')
    : `https://${hostname}`;

export const selectClientProductionOrigin = (
  configuredOrigin: string = webbinPilotBinding.productionOrigin,
): string => originForRoutes(configuredOrigin);

export const normalizeRedirectHostname = (hostname: string): string =>
  hostname.toLowerCase().replace(/^www\./u, '');

export const isHomeRedirect = (
  location: string,
  productionOrigin: string = selectClientProductionOrigin(),
): boolean => {
  const expectedHost = normalizeRedirectHostname(
    new URL(productionOrigin).hostname,
  );
  if (location.startsWith('/')) {
    const path = location.split('?')[0]?.split('#')[0] ?? location;
    return path === '/' || path === '';
  }
  try {
    const parsed = new URL(location);
    const path = parsed.pathname;
    if (path !== '/' && path !== '') return false;
    return normalizeRedirectHostname(parsed.hostname) === expectedHost;
  } catch {
    return false;
  }
};

export const matchesDeletionRedirectTarget = (
  location: string,
  expectedTarget: string,
  productionOrigin: string = selectClientProductionOrigin(),
): boolean => {
  const normalizedTarget = expectedTarget.replace(/\/$/u, '');
  if (normalizedTarget === '' || expectedTarget === '/')
    return isHomeRedirect(location, productionOrigin);
  const normalizedLocation = location.replace(/\/$/u, '');
  return (
    normalizedLocation.endsWith(normalizedTarget) ||
    normalizedLocation.endsWith(`${normalizedTarget}/`)
  );
};

export const selectProductionHostname = (
  domains: readonly {
    gitBranch?: string | null | undefined;
    name: string;
    redirect?: string | null | undefined;
    verified?: boolean | undefined;
  }[],
  productionBranch?: string,
): string | undefined => {
  const eligible = (domain: (typeof domains)[number]) => {
    if (domain.verified === false) return false;
    if (
      domain.redirect !== null &&
      domain.redirect !== undefined &&
      domain.redirect !== ''
    )
      return false;
    return !isVercelAppHostname(domain.name);
  };
  const custom = [...domains]
    .filter((domain) => {
      if (!eligible(domain)) return false;
      const branch = domain.gitBranch;
      if (branch === null || branch === undefined || branch === '') return true;
      return productionBranch === undefined || branch === productionBranch;
    })
    .sort((left, right) => left.name.length - right.name.length);
  if (custom[0] !== undefined) return custom[0].name;
  const assigned = [...domains]
    .filter(eligible)
    .sort((left, right) => left.name.length - right.name.length);
  if (assigned[0] !== undefined) return assigned[0].name;
  return [...domains]
    .filter(
      (domain) =>
        domain.verified !== false &&
        isVercelAppHostname(domain.name) &&
        !isUniqueVercelDeploymentHostname(domain.name),
    )
    .sort((left, right) => left.name.length - right.name.length)[0]?.name;
};

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
    /** Client-visible live origin; defaults to Webbin pilot when omitted. */
    productionOrigin?: string;
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
  const pollIntervalMs = input.pollIntervalMs ?? 5_000;
  const absenceTimeoutMs = input.timeoutMs ?? 10 * 60 * 1_000;
  const clientProductionOrigin = selectClientProductionOrigin(
    input.productionOrigin ?? webbinPilotBinding.productionOrigin,
  );

  const resolveProductionOrigin = (): string => clientProductionOrigin;

  const fetchRouteAbsenceStatus = async (url: string): Promise<number> => {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return 404;
    const location = response.headers.get('location');
    if (
      location !== null &&
      (response.status === 301 ||
        response.status === 308 ||
        response.status === 302 ||
        response.status === 307)
    ) {
      const nextUrl = location.startsWith('http')
        ? location
        : new URL(location, url).toString();
      const redirected = await fetch(nextUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      return redirected.status;
    }
    return response.status;
  };

  const routesStillLive = async (
    production: DeploymentEvidence,
    routes: readonly string[],
  ): Promise<readonly string[]> => {
    const failures: string[] = [];
    for (const route of routes) {
      const url = production.urls[route];
      if (url === undefined) {
        failures.push(route);
        continue;
      }
      const status = await fetchRouteAbsenceStatus(url);
      if (status !== 404) failures.push(route);
    }
    return failures;
  };

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
      const deadline = Date.now() + absenceTimeoutMs;
      do {
        try {
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
          if (!response.ok) {
            const mapped = mapHttpError(response.status, 'project');
            if (mapped.category === 'provider_retryable') {
              await sleep(pollIntervalMs);
              continue;
            }
            throw mapped;
          }
          let deployments: z.infer<typeof deploymentListSchema>['deployments'];
          try {
            deployments = deploymentListSchema.parse(
              await response.json(),
            ).deployments;
          } catch (error) {
            if (error instanceof z.ZodError)
              throw new DomainError(
                'provider_final',
                'Vercel returned invalid deployment evidence.',
              );
            throw error;
          }
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
            throw new DomainError(
              'provider_final',
              'Vercel deployment failed.',
            );
          if (deployment?.readyState === 'READY') {
            const origin =
              environment === 'production'
                ? resolveProductionOrigin()
                : originForRoutes(deployment.url);
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
        } catch (error) {
          if (error instanceof DomainError) {
            if (
              error.category === 'provider_final' ||
              error.category === 'authentication_error' ||
              error.category === 'authorization_error' ||
              error.category === 'policy_denied'
            )
              throw error;
            // provider_retryable and other soft categories keep polling.
          } else {
            // Network / abort timeouts are transient within the deadline.
          }
        }
        await sleep(pollIntervalMs);
      } while (Date.now() < deadline);
      throw new DomainError(
        'provider_retryable',
        'Timed out waiting for Vercel deployment.',
      );
    } finally {
      plaintext.fill(0);
    }
  };

  return {
    async verifyDeletionRedirects(request) {
      const production = await wait(
        request.mergeCommitSha,
        'production',
        request.routes,
      );
      const failures: string[] = [];
      for (const route of request.routes) {
        const expectedTarget = request.redirectTargets[route];
        const url = production.urls[route];
        if (url === undefined || expectedTarget === undefined) {
          failures.push(route);
          continue;
        }
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status !== 301 && response.status !== 308) {
          failures.push(route);
          continue;
        }
        const location = response.headers.get('location');
        if (location === null) {
          failures.push(route);
          continue;
        }
        if (
          !matchesDeletionRedirectTarget(
            location,
            expectedTarget,
            resolveProductionOrigin(),
          )
        )
          failures.push(route);
      }
      if (failures.length > 0)
        throw new DomainError(
          'policy_denied',
          'Production routes do not redirect to site home after deletion.',
          { code: 'route_still_live' },
        );
      return production;
    },
    async verifyAbsence(request) {
      const production = await wait(
        request.mergeCommitSha,
        'production',
        request.routes,
      );
      const absenceDeadline = Date.now() + absenceTimeoutMs;
      do {
        const failures = await routesStillLive(production, request.routes);
        if (failures.length === 0) return production;
        await sleep(pollIntervalMs);
      } while (Date.now() < absenceDeadline);
      throw new DomainError(
        'policy_denied',
        'Production routes are still live after deletion.',
        { code: 'route_still_live' },
      );
    },
    async waitForPreview(request) {
      return wait(request.headCommitSha, 'preview', request.routes);
    },
    async waitForProduction(request) {
      return wait(request.mergeCommitSha, 'production', request.routes);
    },
  };
};
