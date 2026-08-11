import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createGitHubCredentialVerifier,
  githubRegistrationPermissions,
} from '../src/index.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();

const createInput = (
  configuration: Readonly<Record<string, unknown>> = {
    appId: '123',
    clientId: 'Iv1.binflow',
  },
  connectionConfiguration: Readonly<Record<string, unknown>> = {
    defaultBranch: 'main',
    expectedRepository: 'arrobabeto/webbin',
  },
) => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'github-credential',
    keyVersion: 1,
    provider: 'github-app',
    tenantId: 'platform',
  } as const;
  const plaintext = Buffer.from(
    JSON.stringify({
      privateKey,
      webhookSecret: 'fixture-webhook-secret-at-least-32-chars',
    }),
  );
  const envelope = encryptSecret(plaintext, masterKey, secretContext);
  plaintext.fill(0);
  const credential: CredentialForVerification = {
    configuration,
    connection: {
      configuration: connectionConfiguration,
      id: 'connection-1',
      projectId: 'project-webbin',
      tenantId: 'tenant-webbin',
    },
    envelope,
    id: secretContext.credentialId,
    kind: 'github-app',
    ownerScope: 'platform',
    secretContext,
    status: 'unverified',
    version: 1,
  };
  return {
    credential,
    masterKey,
    signal: AbortSignal.timeout(2_000),
  };
};

type MockOverrides = Readonly<{
  appPermissions?: Readonly<Record<string, string>>;
  installationPermissions?: Readonly<Record<string, string>>;
  repositoryNames?: readonly string[];
  repositoryTokenIds?: readonly number[];
}>;

const createGitHubFetch = (overrides: MockOverrides = {}) => {
  const calls: { body?: unknown; method: string; path: string }[] = [];
  let tokenCount = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method =
      init?.method ?? (input instanceof Request ? input.method : 'GET');
    const rawBody = init?.body;
    const body =
      typeof rawBody === 'string' && rawBody.length > 0
        ? JSON.parse(rawBody)
        : undefined;
    calls.push({
      ...(body === undefined ? {} : { body }),
      method,
      path: url.pathname,
    });

    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        headers: {
          'content-type': 'application/json',
          'x-github-request-id': 'safe-id',
        },
        status,
      });
    if (method === 'GET' && url.pathname === '/app') {
      return json({
        client_id: 'Iv1.binflow',
        id: 123,
        permissions: overrides.appPermissions ?? githubRegistrationPermissions,
        slug: 'binflow',
      });
    }
    if (
      method === 'GET' &&
      url.pathname === '/repos/arrobabeto/webbin/installation'
    ) {
      return json({
        account: { login: 'arrobabeto' },
        id: 456,
        permissions:
          overrides.installationPermissions ?? githubRegistrationPermissions,
        repository_selection: 'selected',
        suspended_at: null,
      });
    }
    if (
      method === 'POST' &&
      url.pathname === '/app/installations/456/access_tokens'
    ) {
      tokenCount += 1;
      const repositoryIds =
        typeof body === 'object' && body !== null && 'repository_ids' in body
          ? (body.repository_ids as number[])
          : undefined;
      return json({
        expires_at: '2099-01-01T00:00:00Z',
        permissions:
          repositoryIds === undefined
            ? { metadata: 'read' }
            : { contents: 'read', metadata: 'read' },
        repositories:
          repositoryIds === undefined
            ? undefined
            : (overrides.repositoryTokenIds ?? [789]).map((id) => ({
                full_name: 'arrobabeto/webbin',
                id,
              })),
        repository_selection: 'selected',
        token: `fixture-installation-token-${tokenCount}`,
      });
    }
    if (method === 'GET' && url.pathname === '/installation/repositories') {
      const repositoryNames = overrides.repositoryNames ?? [
        'arrobabeto/webbin',
      ];
      return json({
        repositories: repositoryNames.map((full_name, index) => ({
          full_name,
          id: 789 + index,
        })),
        total_count: repositoryNames.length,
      });
    }
    if (method === 'DELETE' && url.pathname === '/installation/token') {
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && url.pathname === '/repos/arrobabeto/webbin') {
      return json({
        archived: false,
        default_branch: 'main',
        disabled: false,
        full_name: 'arrobabeto/webbin',
        id: 789,
      });
    }
    return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
  });
  return { calls, fetch };
};

describe('GitHub credential verifier', () => {
  it('uses one metadata audit token and one repository-ID read token', async () => {
    const mock = createGitHubFetch();
    const verifier = createGitHubCredentialVerifier({
      apiBaseUrl: 'https://github.test',
      fetch: mock.fetch,
    });

    await expect(verifier.verify(createInput())).resolves.toMatchObject({
      appId: '123',
      externalResourceId: '456',
      installationId: '456',
      repository: 'arrobabeto/webbin',
      repositoryId: '789',
      webhookVerification: 'pending_signed_delivery',
    });
    const tokenRequests = mock.calls.filter(
      (call) =>
        call.method === 'POST' &&
        call.path === '/app/installations/456/access_tokens',
    );
    expect(tokenRequests).toHaveLength(2);
    expect(tokenRequests[0]?.body).toEqual({
      permissions: { metadata: 'read' },
    });
    expect(tokenRequests[1]?.body).toEqual({
      permissions: { contents: 'read', metadata: 'read' },
      repository_ids: [789],
    });
    expect(
      mock.calls.filter(
        (call) =>
          call.method === 'DELETE' && call.path === '/installation/token',
      ),
    ).toHaveLength(2);
  });

  it('rejects any extra registration permission before minting a token', async () => {
    const mock = createGitHubFetch({
      appPermissions: {
        ...githubRegistrationPermissions,
        secrets: 'read',
      },
    });
    const verifier = createGitHubCredentialVerifier({
      apiBaseUrl: 'https://github.test',
      fetch: mock.fetch,
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'policy_denied',
    });
    expect(
      mock.calls.some((call) => call.path.includes('/access_tokens')),
    ).toBe(false);
  });

  it('rejects an installation that exposes another repository', async () => {
    const mock = createGitHubFetch({
      repositoryNames: ['arrobabeto/webbin', 'arrobabeto/other'],
    });
    const verifier = createGitHubCredentialVerifier({
      apiBaseUrl: 'https://github.test',
      fetch: mock.fetch,
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'policy_denied',
    });
    expect(
      mock.calls.filter(
        (call) =>
          call.method === 'DELETE' && call.path === '/installation/token',
      ),
    ).toHaveLength(1);
  });

  it('rejects a project binding with the wrong default branch', async () => {
    const mock = createGitHubFetch();
    const verifier = createGitHubCredentialVerifier({
      apiBaseUrl: 'https://github.test',
      fetch: mock.fetch,
    });

    await expect(
      verifier.verify(
        createInput(
          { appId: '123', clientId: 'Iv1.binflow' },
          {
            defaultBranch: 'develop',
            expectedRepository: 'arrobabeto/webbin',
          },
        ),
      ),
    ).rejects.toMatchObject({ category: 'policy_denied' });
    expect(
      mock.calls.some((call) => call.path.includes('/access_tokens')),
    ).toBe(false);
  });

  it('rejects a repository token that returns more than the requested repository', async () => {
    const mock = createGitHubFetch({ repositoryTokenIds: [789, 790] });
    const verifier = createGitHubCredentialVerifier({
      apiBaseUrl: 'https://github.test',
      fetch: mock.fetch,
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'policy_denied',
    });
  });

  it('aborts a hanging installation-token request', async () => {
    const mock = createGitHubFetch();
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (
        method === 'POST' &&
        url.pathname === '/app/installations/456/access_tokens'
      ) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted === true) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
      }
      return mock.fetch(input, init);
    });
    const verifier = createGitHubCredentialVerifier({
      apiBaseUrl: 'https://github.test',
      fetch,
    });
    const input = createInput();

    await expect(
      verifier.verify({ ...input, signal: AbortSignal.timeout(20) }),
    ).rejects.toMatchObject({ category: 'provider_retryable' });
  });
});
