import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createVercelCredentialVerifier,
  createVercelDeploymentPort,
  isHomeRedirect,
  isUniqueVercelDeploymentHostname,
  isVercelAppHostname,
  matchesDeletionRedirectTarget,
  normalizeRedirectHostname,
  selectClientProductionOrigin,
  selectProductionHostname,
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
      if (url.pathname.endsWith('/domains')) {
        return new Response(
          JSON.stringify({
            domains: [
              {
                name: 'www.webbin.com.mx',
                redirect: 'webbin.com.mx',
                verified: true,
              },
              {
                gitBranch: 'main',
                name: 'webbin.com.mx',
                redirect: null,
                verified: true,
              },
              {
                name: 'webbin.vercel.app',
                verified: true,
              },
            ],
          }),
        );
      }
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
                    url: 'webbin-prod.vercel.app',
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
                    url: 'webbin-preview.vercel.app',
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
      urls: {
        '/es/articulos/example':
          'https://webbin-preview.vercel.app/es/articulos/example',
      },
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
      urls: {
        '/es/articulos/example': 'https://webbin.com.mx/es/articulos/example',
      },
    });
    expect(calls[0]?.searchParams.has('target')).toBe(false);
    expect(calls[1]?.searchParams.get('target')).toBe('production');
    expect(calls).toHaveLength(2);
  });

  it('keeps polling after a transient lookup failure until READY', async () => {
    const base = createInput();
    let polls = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      polls += 1;
      if (polls === 1) throw new TypeError('network down');
      if (polls === 2) return new Response('{}', { status: 503 });
      return new Response(
        JSON.stringify({
          deployments: [
            {
              createdAt: 1_787_000_000_000,
              meta: { githubCommitSha: 'preview-sha' },
              name: 'webbin',
              readyState: 'READY',
              target: null,
              uid: 'preview-1',
              url: 'webbin-preview.vercel.app',
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
      timeoutMs: 5_000,
    });
    await expect(
      port.waitForPreview({
        headCommitSha: 'preview-sha',
        routes: ['/es/articulos/example'],
      }),
    ).resolves.toMatchObject({
      deploymentId: 'preview-1',
      sha: 'preview-sha',
    });
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('still fails closed when Vercel reports ERROR', async () => {
    const base = createInput();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            deployments: [
              {
                createdAt: 1_787_000_000_000,
                meta: { githubCommitSha: 'preview-sha' },
                name: 'webbin',
                readyState: 'ERROR',
                target: null,
                uid: 'preview-bad',
                url: 'webbin-preview.vercel.app',
              },
            ],
          }),
        ),
    );
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
    ).rejects.toMatchObject({ category: 'provider_final' });
  });

  it('accepts home redirects with apex and www hostnames after deletion', async () => {
    const base = createInput();
    const route =
      '/articulos/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph';
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v6/deployments') {
        return new Response(
          JSON.stringify({
            deployments: [
              {
                createdAt: 1_787_000_000_000,
                meta: { githubCommitSha: 'merge-sha' },
                name: 'webbin',
                readyState: 'READY',
                target: 'production',
                uid: 'production-1',
                url: 'webbin-prod.vercel.app',
              },
            ],
          }),
        );
      }
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.hostname.endsWith('webbin.com.mx')) {
        return new Response(null, {
          headers: { location: 'https://www.webbin.com.mx/' },
          status: 301,
        });
      }
      return new Response('unexpected', { status: 500 });
    });
    const port = createVercelDeploymentPort({
      credential: { ...base.credential, status: 'active' },
      fetch,
      masterKey: base.masterKey,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    await expect(
      port.verifyDeletionRedirects({
        mergeCommitSha: 'merge-sha',
        redirectTargets: { [route]: '/' },
        routes: [route],
      }),
    ).resolves.toMatchObject({
      environment: 'production',
      sha: 'merge-sha',
    });
  });

  it('polls verifyAbsence until deleted routes return 404', async () => {
    const base = createInput();
    const route = '/articulos/deleted-post';
    let routeChecks = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v6/deployments') {
        return new Response(
          JSON.stringify({
            deployments: [
              {
                createdAt: 1_787_000_000_000,
                meta: { githubCommitSha: 'merge-sha' },
                name: 'webbin',
                readyState: 'READY',
                target: 'production',
                uid: 'production-1',
                url: 'webbin-prod.vercel.app',
              },
            ],
          }),
        );
      }
      if ((init?.method ?? 'GET') === 'GET' && url.pathname === route) {
        routeChecks += 1;
        return new Response('still live', {
          status: routeChecks < 3 ? 200 : 404,
        });
      }
      return new Response('missing', { status: 404 });
    });
    const port = createVercelDeploymentPort({
      credential: { ...base.credential, status: 'active' },
      fetch,
      masterKey: base.masterKey,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    await expect(
      port.verifyAbsence({
        mergeCommitSha: 'merge-sha',
        routes: [route],
      }),
    ).resolves.toMatchObject({
      environment: 'production',
      sha: 'merge-sha',
    });
    expect(routeChecks).toBeGreaterThanOrEqual(3);
  });

  it('follows apex-to-www redirects when verifying absence', async () => {
    const base = createInput();
    const route = '/es/articulos/deleted-post';
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v6/deployments') {
        return new Response(
          JSON.stringify({
            deployments: [
              {
                createdAt: 1_787_000_000_000,
                meta: { githubCommitSha: 'merge-sha' },
                name: 'webbin',
                readyState: 'READY',
                target: 'production',
                uid: 'production-1',
                url: 'webbin-prod.vercel.app',
              },
            ],
          }),
        );
      }
      if ((init?.method ?? 'GET') === 'GET' && url.hostname === 'webbin.com.mx') {
        return new Response('', {
          headers: {
            location: `https://www.webbin.com.mx${url.pathname}`,
          },
          status: 308,
        });
      }
      if ((init?.method ?? 'GET') === 'GET' && url.hostname === 'www.webbin.com.mx') {
        return new Response('not found', { status: 404 });
      }
      return new Response('missing', { status: 404 });
    });
    const port = createVercelDeploymentPort({
      credential: { ...base.credential, status: 'active' },
      fetch,
      masterKey: base.masterKey,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });

    await expect(
      port.verifyAbsence({
        mergeCommitSha: 'merge-sha',
        routes: [route],
      }),
    ).resolves.toMatchObject({
      environment: 'production',
      sha: 'merge-sha',
    });
  });
});

describe('deletion redirect matching', () => {
  it('treats apex and www home locations as equivalent', () => {
    expect(isHomeRedirect('/', selectClientProductionOrigin())).toBe(true);
    expect(
      isHomeRedirect(
        'https://webbin.com.mx/',
        selectClientProductionOrigin(),
      ),
    ).toBe(true);
    expect(
      isHomeRedirect(
        'https://www.webbin.com.mx/',
        selectClientProductionOrigin(),
      ),
    ).toBe(true);
    expect(normalizeRedirectHostname('WWW.Webbin.com.mx')).toBe('webbin.com.mx');
    expect(
      matchesDeletionRedirectTarget(
        'https://www.webbin.com.mx/',
        '/',
        selectClientProductionOrigin(),
      ),
    ).toBe(true);
    expect(
      matchesDeletionRedirectTarget(
        'https://webbin.com.mx/proyectos',
        '/',
        selectClientProductionOrigin(),
      ),
    ).toBe(false);
  });
});

describe('production hostname selection', () => {
  it('prefers the verified public domain over Vercel app hostnames', () => {
    expect(
      isVercelAppHostname('webbin-dxskrd4k6-arrobabetos-projects.vercel.app'),
    ).toBe(true);
    expect(
      selectProductionHostname([
        { name: 'webbin.vercel.app', verified: true },
        {
          name: 'www.webbin.com.mx',
          redirect: 'webbin.com.mx',
          verified: true,
        },
        { name: 'webbin.com.mx', redirect: null, verified: true },
      ]),
    ).toBe('webbin.com.mx');
  });

  it('accepts a custom domain assigned to the production git branch', () => {
    expect(
      selectProductionHostname(
        [
          { gitBranch: 'main', name: 'webbin.com.mx', verified: true },
          { name: 'webbin.vercel.app', verified: true },
        ],
        'main',
      ),
    ).toBe('webbin.com.mx');
  });

  it('falls back to a custom domain even when its git branch is not main', () => {
    expect(
      selectProductionHostname(
        [{ gitBranch: 'production', name: 'webbin.com.mx', verified: true }],
        'main',
      ),
    ).toBe('webbin.com.mx');
  });

  it('uses the stable project alias rather than a unique deployment hostname', () => {
    expect(
      isUniqueVercelDeploymentHostname(
        'webbin-h17vznsa8-arrobabetos-projects.vercel.app',
      ),
    ).toBe(true);
    expect(isUniqueVercelDeploymentHostname('webbin.vercel.app')).toBe(false);
    expect(
      selectProductionHostname([
        {
          name: 'webbin-h17vznsa8-arrobabetos-projects.vercel.app',
          verified: true,
        },
        { name: 'webbin.vercel.app', verified: true },
      ]),
    ).toBe('webbin.vercel.app');
  });

  it('does not fail production wait when the project domain list is empty', async () => {
    const base = createInput();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/domains')) {
        return new Response(JSON.stringify({ domains: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          deployments: [
            {
              createdAt: 1_787_000_000_000,
              meta: { githubCommitSha: 'merge-sha' },
              name: 'webbin',
              readyState: 'READY',
              target: 'production',
              uid: 'production-1',
              url: 'webbin-prod.vercel.app',
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
      port.waitForProduction({
        mergeCommitSha: 'merge-sha',
        routes: ['/es/articulos/example'],
      }),
    ).resolves.toMatchObject({
      urls: {
        '/es/articulos/example': 'https://webbin.com.mx/es/articulos/example',
      },
    });
  });

  it('uses the live origin instead of a unique Vercel hostname', () => {
    expect(selectClientProductionOrigin()).toBe('https://webbin.com.mx');
    expect(selectClientProductionOrigin('https://webbin.com.mx/')).toBe(
      'https://webbin.com.mx',
    );
  });
});
