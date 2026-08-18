import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createVercelCredentialVerifier,
  createVercelDeploymentPort,
} from '../src/index.js';

const createInput = (
  connectionConfiguration: Readonly<Record<string, unknown>> = {
    expectedProductionBranch: 'main',
    expectedRepository: 'arrobabeto/webbin',
    projectId: 'prj_webbin',
    teamId: 'team_binflow',
  },
) => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'vercel-credential',
    keyVersion: 1,
    provider: 'vercel',
    tenantId: 'tenant-webbin',
  } as const;
  const plaintext = Buffer.from(JSON.stringify({ token: 'fixture-token' }));
  const envelope = encryptSecret(plaintext, masterKey, secretContext);
  plaintext.fill(0);
  const credential: CredentialForVerification = {
    configuration: {},
    connection: {
      configuration: connectionConfiguration,
      id: 'connection-1',
      projectId: 'project-webbin',
      tenantId: 'tenant-webbin',
    },
    envelope,
    id: secretContext.credentialId,
    kind: 'vercel',
    ownerScope: 'project',
    projectId: 'project-webbin',
    secretContext,
    status: 'unverified',
    tenantId: secretContext.tenantId,
    version: 1,
  };
  return {
    credential,
    masterKey,
    signal: AbortSignal.timeout(1_000),
  };
};

describe('Vercel credential verifier', () => {
  it('reads identity and the tenant-qualified project without mutation', async () => {
    const calls: { method: string; url: URL }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input));
      calls.push({ method: init?.method ?? 'GET', url });
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer fixture-token',
      );
      return url.pathname === '/v2/user'
        ? new Response(JSON.stringify({ user: { id: 'user_owner' } }), {
            status: 200,
          })
        : new Response(
            JSON.stringify({
              accountId: 'team_binflow',
              id: 'prj_webbin',
              link: {
                org: 'arrobabeto',
                productionBranch: 'main',
                repo: 'webbin',
                type: 'github',
              },
              name: 'webbin',
            }),
            { status: 200 },
          );
    });
    const verifier = createVercelCredentialVerifier({
      apiBaseUrl: 'https://vercel.test',
      fetch,
    });

    await expect(verifier.verify(createInput())).resolves.toMatchObject({
      accountId: 'team_binflow',
      externalResourceId: 'prj_webbin',
      productionBranch: 'main',
      projectId: 'prj_webbin',
      repository: 'arrobabeto/webbin',
      teamId: 'team_binflow',
      userId: 'user_owner',
    });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET']);
    expect(calls[1]?.url.pathname).toBe('/v9/projects/prj_webbin');
    expect(calls[1]?.url.searchParams.get('teamId')).toBe('team_binflow');
  });

  it('maps token rejection without persisting a provider body', async () => {
    const verifier = createVercelCredentialVerifier({
      fetch: vi.fn(async () => new Response('{}', { status: 401 })),
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authentication_error',
    });
  });

  it('fails closed when the project points at another repository', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/v2/user'
        ? new Response(JSON.stringify({ user: { id: 'user_owner' } }))
        : new Response(
            JSON.stringify({
              accountId: 'team_binflow',
              id: 'prj_webbin',
              link: {
                org: 'arrobabeto',
                productionBranch: 'main',
                repo: 'other',
                type: 'github',
              },
              name: 'webbin',
            }),
          );
    });
    const verifier = createVercelCredentialVerifier({ fetch });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'policy_denied',
    });
  });

  it('rejects a credential that is not project-owned before network access', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const verifier = createVercelCredentialVerifier({ fetch });
    const input = createInput();

    await expect(
      verifier.verify({
        ...input,
        credential: {
          ...input.credential,
          ownerScope: 'tenant',
          projectId: undefined,
        },
      }),
    ).rejects.toMatchObject({ category: 'policy_denied' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a personal project to belong to the verified user', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      return url.pathname === '/v2/user'
        ? new Response(JSON.stringify({ user: { id: 'user_owner' } }))
        : new Response(
            JSON.stringify({
              accountId: 'another_user',
              id: 'prj_webbin',
              link: {
                org: 'arrobabeto',
                productionBranch: 'main',
                repo: 'webbin',
                type: 'github',
              },
              name: 'webbin',
            }),
          );
    });
    const verifier = createVercelCredentialVerifier({ fetch });

    await expect(
      verifier.verify(
        createInput({
          expectedProductionBranch: 'main',
          expectedRepository: 'arrobabeto/webbin',
          projectId: 'prj_webbin',
        }),
      ),
    ).rejects.toMatchObject({ category: 'policy_denied' });
  });

  it('maps identity endpoint 403 to authentication failure', async () => {
    const verifier = createVercelCredentialVerifier({
      fetch: vi.fn(async () => new Response('{}', { status: 403 })),
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authentication_error',
    });
  });

  it('rejects operator-modified Webbin policy before network access', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const verifier = createVercelCredentialVerifier({ fetch });

    await expect(
      verifier.verify(
        createInput({
          expectedProductionBranch: 'develop',
          expectedRepository: 'arrobabeto/other',
          projectId: 'prj_webbin',
          teamId: 'team_binflow',
        }),
      ),
    ).rejects.toMatchObject({ category: 'policy_denied' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Vercel deployment correlation', () => {
  it('does not send target=preview and rejects production deployments as previews', async () => {
    const base = createInput();
    const calls: URL[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const target = url.searchParams.get('target');
      return new Response(
        JSON.stringify({
          deployments:
            target === 'production'
              ? [
                  {
                    createdAt: 1_787_000_000_000,
                    meta: { githubCommitSha: 'merge-sha' },
                    name: 'webbin',
                    readyState: 'READY',
                    target: 'production',
                    uid: 'production-1',
                    url: 'webbin.example',
                  },
                ]
              : [
                  {
                    createdAt: 1_787_000_000_000,
                    meta: { githubCommitSha: 'preview-sha' },
                    name: 'webbin',
                    readyState: 'READY',
                    target: null,
                    uid: 'preview-1',
                    url: 'preview.example',
                  },
                ],
        }),
      );
    });
    const port = createVercelDeploymentPort({
      credential: { ...base.credential, status: 'active' },
      fetch,
      masterKey: base.masterKey,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    await expect(
      port.waitForPreview({
        headCommitSha: 'preview-sha',
        routes: ['/es/articulos/example'],
      }),
    ).resolves.toMatchObject({
      deploymentId: 'preview-1',
      environment: 'preview',
      sha: 'preview-sha',
    });
    await expect(
      port.waitForProduction({
        mergeCommitSha: 'merge-sha',
        routes: ['/es/articulos/example'],
      }),
    ).resolves.toMatchObject({
      deploymentId: 'production-1',
      environment: 'production',
      sha: 'merge-sha',
    });
    expect(calls[0]?.searchParams.has('target')).toBe(false);
    expect(calls[1]?.searchParams.get('target')).toBe('production');
  });
});
