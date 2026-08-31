import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import { createGitHubRepositoryPublicationPort } from '../src/index.js';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();

const publicationPermissions = {
  checks: 'read',
  contents: 'write',
  deployments: 'read',
  metadata: 'read',
  pull_requests: 'write',
  statuses: 'read',
} as const;

const createCredential = () => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'github-publication',
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
    configuration: { appId: '123', clientId: 'Iv1.binflow' },
    connection: {
      configuration: {
        defaultBranch: 'main',
        expectedRepository: 'arrobabeto/webbin',
      },
      id: 'connection-1',
      projectId: 'project-webbin',
      tenantId: 'tenant-webbin',
    },
    envelope,
    id: secretContext.credentialId,
    kind: 'github-app',
    ownerScope: 'platform',
    secretContext,
    status: 'active',
    version: 1,
  };
  return { credential, masterKey };
};

describe('GitHub repository publication port', () => {
  it('completes PR revalidation when the operation returns void', async () => {
    const { credential, masterKey } = createCredential();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
          status,
        });
      if (
        method === 'POST' &&
        url.pathname === '/app/installations/456/access_tokens'
      ) {
        return json({
          expires_at: '2099-01-01T00:00:00Z',
          permissions: publicationPermissions,
          repositories: [{ full_name: 'arrobabeto/webbin', id: 789 }],
          repository_ids: [789],
          token: 'fixture-publication-token',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/14'
      ) {
        return json({
          head: { sha: '792e71cd89d961fd2a6a80fd476501ea377ab329' },
          html_url: 'https://github.com/arrobabeto/webbin/pull/14',
          number: 14,
          state: 'open',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/14/files'
      ) {
        return json([
          {
            filename:
              'public/images/articles/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.avif',
          },
          {
            filename:
              'src/content/articulos-es/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.md',
          },
          {
            filename:
              'src/content/articulos/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.md',
          },
        ]);
      }
      if (
        method === 'GET' &&
        url.pathname.endsWith(
          '/commits/792e71cd89d961fd2a6a80fd476501ea377ab329/status',
        )
      ) {
        return json({ state: 'success' });
      }
      if (method === 'DELETE' && url.pathname === '/installation/token') {
        return new Response(null, { status: 204 });
      }
      return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
    });
    const port = createGitHubRepositoryPublicationPort({
      apiBaseUrl: 'https://github.test',
      credential,
      fetch,
      installationId: '456',
      masterKey,
      repositoryId: '789',
    });

    await expect(
      port.revalidate({
        expectedFiles: [
          'public/images/articles/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.avif',
          'src/content/articulos-es/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.md',
          'src/content/articulos/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.md',
        ],
        expectedHeadSha: '792e71cd89d961fd2a6a80fd476501ea377ab329',
        pullRequestId: '14',
      }),
    ).resolves.toBeUndefined();
  });

  it('treats an already-merged PR with the approved head as valid revalidation', async () => {
    const { credential, masterKey } = createCredential();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
          status,
        });
      if (
        method === 'POST' &&
        url.pathname === '/app/installations/456/access_tokens'
      ) {
        return json({
          expires_at: '2099-01-01T00:00:00Z',
          permissions: publicationPermissions,
          repositories: [{ full_name: 'arrobabeto/webbin', id: 789 }],
          repository_ids: [789],
          token: 'fixture-publication-token',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/15'
      ) {
        return json({
          head: { sha: 'dc55120932d4d51cbaac4a2b84f8a8673cd6e693' },
          html_url: 'https://github.com/arrobabeto/webbin/pull/15',
          merge_commit_sha: '280259b3d1105b802f70a0ee29eb7f9615b3fb52',
          merged: true,
          number: 15,
          state: 'closed',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/15/files'
      ) {
        return json([
          {
            filename:
              'public/images/articles/ventajas-de-evaluar-mastra-como-interfaz-agentica-para-proyectos-web.avif',
          },
          {
            filename:
              'src/content/articulos-es/ventajas-de-evaluar-mastra-como-interfaz-agentica-para-proyectos-web.md',
          },
          {
            filename:
              'src/content/articulos/ventajas-de-evaluar-mastra-como-interfaz-agentica-para-proyectos-web.md',
          },
        ]);
      }
      if (method === 'DELETE' && url.pathname === '/installation/token') {
        return new Response(null, { status: 204 });
      }
      return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
    });
    const port = createGitHubRepositoryPublicationPort({
      apiBaseUrl: 'https://github.test',
      credential,
      fetch,
      installationId: '456',
      masterKey,
      repositoryId: '789',
    });

    await expect(
      port.revalidate({
        expectedFiles: [
          'public/images/articles/ventajas-de-evaluar-mastra-como-interfaz-agentica-para-proyectos-web.avif',
          'src/content/articulos-es/ventajas-de-evaluar-mastra-como-interfaz-agentica-para-proyectos-web.md',
          'src/content/articulos/ventajas-de-evaluar-mastra-como-interfaz-agentica-para-proyectos-web.md',
        ],
        expectedHeadSha: 'dc55120932d4d51cbaac4a2b84f8a8673cd6e693',
        pullRequestId: '15',
      }),
    ).resolves.toBeUndefined();
  });

  it('returns readFileAtRef content when token cleanup fails after a successful read', async () => {
    const { credential, masterKey } = createCredential();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
          status,
        });
      if (
        method === 'POST' &&
        url.pathname === '/app/installations/456/access_tokens'
      ) {
        return json({
          expires_at: '2099-01-01T00:00:00Z',
          permissions: publicationPermissions,
          repositories: [{ full_name: 'arrobabeto/webbin', id: 789 }],
          repository_ids: [789],
          token: 'fixture-publication-token',
        });
      }
      if (method === 'GET' && url.pathname.includes('/contents/')) {
        return json({
          content: Buffer.from('---\ntitulo: Sample\n---\n').toString('base64'),
          encoding: 'base64',
          sha: 'abc123',
        });
      }
      if (method === 'DELETE' && url.pathname === '/installation/token') {
        return new Response('cleanup failed', { status: 503 });
      }
      return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
    });
    const port = createGitHubRepositoryPublicationPort({
      apiBaseUrl: 'https://github.test',
      credential,
      fetch,
      installationId: '456',
      masterKey,
      repositoryId: '789',
    });

    await expect(
      port.readFileAtRef({
        path: 'src/content/articulos/sample.md',
        ref: 'main',
      }),
    ).resolves.toEqual(Buffer.from('---\ntitulo: Sample\n---\n'));
  });

  it('completes deletion revalidation without waiting for commit status', async () => {
    const { credential, masterKey } = createCredential();
    const statusCalls: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
          status,
        });
      if (
        method === 'POST' &&
        url.pathname === '/app/installations/456/access_tokens'
      ) {
        return json({
          expires_at: '2099-01-01T00:00:00Z',
          permissions: publicationPermissions,
          repositories: [{ full_name: 'arrobabeto/webbin', id: 789 }],
          repository_ids: [789],
          token: 'fixture-publication-token',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/35'
      ) {
        return json({
          head: { sha: '5f8f0f30e0ed86123e226f3d158cd72dd3cae243' },
          html_url: 'https://github.com/arrobabeto/webbin/pull/35',
          number: 35,
          state: 'open',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/35/files'
      ) {
        return json([
          { filename: 'public/_redirects' },
          {
            filename:
              'src/content/articulos-es/sop-para-crear-una-economia-de-creditos-basada-en-tokens-de-ia.md',
          },
          {
            filename:
              'src/content/articulos/sop-para-crear-una-economia-de-creditos-basada-en-tokens-de-ia.md',
          },
        ]);
      }
      if (method === 'GET' && url.pathname.includes('/status')) {
        statusCalls.push(url.pathname);
        return json({ state: 'pending' });
      }
      if (method === 'DELETE' && url.pathname === '/installation/token') {
        return new Response(null, { status: 204 });
      }
      return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
    });
    const port = createGitHubRepositoryPublicationPort({
      apiBaseUrl: 'https://github.test',
      credential,
      fetch,
      installationId: '456',
      masterKey,
      repositoryId: '789',
    });

    await expect(
      port.revalidate({
        expectedFiles: [
          'public/_redirects',
          'src/content/articulos-es/sop-para-crear-una-economia-de-creditos-basada-en-tokens-de-ia.md',
          'src/content/articulos/sop-para-crear-una-economia-de-creditos-basada-en-tokens-de-ia.md',
        ],
        expectedHeadSha: '5f8f0f30e0ed86123e226f3d158cd72dd3cae243',
        pullRequestId: '35',
        requireCommitStatus: false,
      }),
    ).resolves.toBeUndefined();
    expect(statusCalls).toEqual([]);
  });

  it('publishes against the verified connection repository, not only Webbin', async () => {
    const { credential, masterKey } = createCredential();
    credential.connection = {
      configuration: {
        defaultBranch: 'main',
        expectedRepository: 'arrobabeto/bistro',
      },
      id: 'connection-bistro',
      projectId: 'project-bistro',
      tenantId: 'tenant-bistro',
    };
    const seen: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : 'GET');
      seen.push(`${method} ${url.pathname}`);
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json' },
          status,
        });
      if (
        method === 'POST' &&
        url.pathname === '/app/installations/456/access_tokens'
      ) {
        return json({
          expires_at: '2099-01-01T00:00:00Z',
          permissions: publicationPermissions,
          repositories: [{ full_name: 'arrobabeto/bistro', id: 789 }],
          repository_ids: [789],
          token: 'fixture-publication-token',
        });
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/bistro/pulls'
      ) {
        return json([]);
      }
      if (method === 'GET' && url.pathname.includes('/git/ref/heads')) {
        return json({ object: { sha: 'base-sha-bistro-mainaaaaaaaaaaaaaa' } });
      }
      if (
        method === 'POST' &&
        url.pathname === '/repos/arrobabeto/bistro/git/refs'
      ) {
        return json({ ref: 'refs/heads/bot/bistro/create-blog/req-slug' });
      }
      if (
        method === 'GET' &&
        url.pathname.includes('/repos/arrobabeto/bistro/contents/')
      ) {
        return json({ message: 'Not Found' }, 404);
      }
      if (
        method === 'PUT' &&
        url.pathname.includes('/repos/arrobabeto/bistro/contents/')
      ) {
        return json({ commit: { sha: 'head-sha-bistroaaaaaaaaaaaaaaaaaaaa' } });
      }
      if (
        method === 'POST' &&
        url.pathname === '/repos/arrobabeto/bistro/pulls'
      ) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          base?: string;
        };
        expect(body.base).toBe('main');
        return json({
          head: { sha: 'head-sha-bistroaaaaaaaaaaaaaaaaaaaa' },
          html_url: 'https://github.com/arrobabeto/bistro/pull/1',
          number: 1,
          state: 'open',
        });
      }
      if (method === 'DELETE' && url.pathname === '/installation/token') {
        return new Response(null, { status: 204 });
      }
      return json({ message: `Unexpected ${method} ${url.pathname}` }, 500);
    });
    const port = createGitHubRepositoryPublicationPort({
      apiBaseUrl: 'https://github.test',
      credential,
      fetch,
      installationId: '456',
      masterKey,
      repositoryId: '789',
    });

    await expect(
      port.createDraft({
        branch: 'bot/bistro/create-blog/req-slug',
        files: [
          {
            bytes: new Uint8Array([1]),
            mime: 'text/markdown',
            path: 'src/content/blog-de/hello.md',
            sha256: 'a'.repeat(64),
          },
        ],
        requestId: 'req-bistro',
        slug: 'hello',
      }),
    ).resolves.toMatchObject({
      headCommitSha: 'head-sha-bistroaaaaaaaaaaaaaaaaaaaa',
      pullRequestId: '1',
    });
    expect(seen.some((entry) => entry.includes('/repos/arrobabeto/bistro/'))).toBe(
      true,
    );
    expect(seen.some((entry) => entry.includes('/repos/arrobabeto/webbin/'))).toBe(
      false,
    );
  });
});
