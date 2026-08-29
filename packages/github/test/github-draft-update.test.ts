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

describe('github draft update-in-place', () => {
  it('rewrites files on an existing PR branch instead of returning stale head', async () => {
    const { credential, masterKey } = createCredential();
    const puts: string[] = [];
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
        url.pathname === '/repos/arrobabeto/webbin/pulls' &&
        url.searchParams.get('head') ===
          'arrobabeto:bot/webbin/create-blog/req-slug'
      ) {
        return json([
          {
            head: { sha: 'old-head-shaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
            html_url: 'https://github.com/arrobabeto/webbin/pull/9',
            number: 9,
            state: 'open',
          },
        ]);
      }
      if (
        method === 'GET' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls/9/files'
      ) {
        return json([
          { filename: 'public/images/articles/slug.avif' },
          { filename: 'src/content/articulos-es/slug.md' },
          { filename: 'src/content/articulos/slug.md' },
        ]);
      }
      if (
        method === 'GET' &&
        url.pathname.startsWith('/repos/arrobabeto/webbin/contents/')
      ) {
        return json({ sha: `blob-${url.pathname.split('/').pop()}` });
      }
      if (
        method === 'PUT' &&
        url.pathname.startsWith('/repos/arrobabeto/webbin/contents/')
      ) {
        puts.push(url.pathname);
        return json({
          commit: { sha: `new-head-${puts.length}aaaaaaaaaaaaaaaaaaaaaaaa` },
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
    const result = await port.createDraft({
      branch: 'bot/webbin/create-blog/req-slug',
      files: [
        {
          bytes: new Uint8Array([1]),
          mime: 'text/markdown',
          path: 'src/content/articulos-es/slug.md',
          sha256: 'a'.repeat(64),
        },
        {
          bytes: new Uint8Array([2]),
          mime: 'text/markdown',
          path: 'src/content/articulos/slug.md',
          sha256: 'b'.repeat(64),
        },
        {
          bytes: new Uint8Array([3]),
          mime: 'image/avif',
          path: 'public/images/articles/slug.avif',
          sha256: 'c'.repeat(64),
        },
      ],
      requestId: 'req',
      slug: 'slug',
    });
    expect(puts).toHaveLength(3);
    expect(result.headCommitSha).toContain('new-head-3');
    expect(result.pullRequestId).toBe('9');
  });

  it('updates existing _redirects with sha and skips missing optional deletions', async () => {
    const { credential, masterKey } = createCredential();
    const puts: Array<{ path: string; hasSha: boolean }> = [];
    const deletes: string[] = [];
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
        url.pathname === '/repos/arrobabeto/webbin/pulls'
      ) {
        return json([]);
      }
      if (
        method === 'GET' &&
        url.pathname.includes('/git/ref/heads')
      ) {
        return json({ object: { sha: 'base-shaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
      }
      if (
        method === 'POST' &&
        url.pathname === '/repos/arrobabeto/webbin/git/refs'
      ) {
        return json({ ref: 'refs/heads/bot/webbin/delete-blog/req-slug' });
      }
      if (method === 'GET' && url.pathname.includes('/contents/')) {
        const decoded = decodeURIComponent(url.pathname);
        if (decoded.endsWith('/public/_redirects')) {
          return json({ sha: 'redirects-sha' });
        }
        if (decoded.includes('/src/content/articulos')) {
          return json({ sha: `blob-${decoded.split('/').pop()}` });
        }
        if (decoded.includes('/public/images/articles/')) {
          return json({ message: 'Not Found' }, 404);
        }
      }
      if (method === 'PUT' && url.pathname.includes('/contents/')) {
        const decoded = decodeURIComponent(url.pathname);
        if (!decoded.endsWith('/public/_redirects')) {
          return json({ message: `Unexpected PUT ${decoded}` }, 500);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          sha?: string;
        };
        puts.push({
          hasSha: typeof body.sha === 'string',
          path: 'public/_redirects',
        });
        return json({
          commit: { sha: 'head-after-redirectsaaaaaaaaaaaaaaaaaaaaaa' },
        });
      }
      if (method === 'DELETE' && url.pathname.includes('/contents/')) {
        deletes.push(decodeURIComponent(url.pathname));
        return json({
          commit: {
            sha: `head-after-delete-${deletes.length}aaaaaaaaaaaaaaaaaaaa`,
          },
        });
      }
      if (
        method === 'POST' &&
        url.pathname === '/repos/arrobabeto/webbin/pulls'
      ) {
        return json({
          head: { sha: 'head-after-delete-2aaaaaaaaaaaaaaaaaaaa' },
          html_url: 'https://github.com/arrobabeto/webbin/pull/22',
          number: 22,
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
    const result = await port.createDraft({
      branch: 'bot/webbin/delete-blog/req-slug',
      deletions: [
        'public/images/articles/slug.avif',
        'src/content/articulos-es/slug.md',
        'src/content/articulos/slug.md',
      ],
      files: [
        {
          bytes: new TextEncoder().encode('/articulos/slug /proyectos 301\n'),
          mime: 'text/plain',
          path: 'public/_redirects',
          sha256: 'd'.repeat(64),
        },
      ],
      requestId: 'req',
      slug: 'slug',
    });
    expect(puts).toEqual([{ hasSha: true, path: 'public/_redirects' }]);
    expect(deletes).toHaveLength(2);
    expect(result.files).toEqual([
      'public/_redirects',
      'src/content/articulos-es/slug.md',
      'src/content/articulos/slug.md',
    ]);
    expect(result.pullRequestId).toBe('22');
  });
});
