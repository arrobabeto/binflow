import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createWordpressCredentialVerifier,
  createWordpressRestClient,
  normalizeWordpressSiteOrigin,
  plainWordpressTitle,
} from '../src/index.js';

const ORIGIN = 'https://blog.example.com';
const FIXTURE_PASSWORD = 'abcd efgh ijkl mnop qrst uvwx';

const createInput = (
  overrides: Partial<CredentialForVerification> = {},
  configuration: Record<string, unknown> = {
    siteOrigin: ORIGIN,
    username: 'binflow',
  },
) => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'wordpress-credential',
    keyVersion: 1,
    provider: 'wordpress-api',
    tenantId: 'tenant-demo',
  } as const;
  const plaintext = Buffer.from(
    JSON.stringify({ applicationPassword: FIXTURE_PASSWORD }),
  );
  const envelope = encryptSecret(plaintext, masterKey, secretContext);
  plaintext.fill(0);
  const credential: CredentialForVerification = {
    configuration,
    connection: {
      configuration,
      id: 'connection-1',
      projectId: 'project-demo',
      tenantId: 'tenant-demo',
    },
    envelope,
    id: secretContext.credentialId,
    kind: 'wordpress-api',
    ownerScope: 'project',
    projectId: 'project-demo',
    secretContext,
    status: 'unverified',
    tenantId: secretContext.tenantId,
    version: 1,
    ...overrides,
  };
  return { credential, masterKey, signal: AbortSignal.timeout(5_000) };
};

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', ...init.headers },
    status: init.status ?? 200,
  });

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

const siteFetch = (
  overrides: Partial<Record<'discovery' | 'me' | 'posts' | 'categories', Route>> = {},
) =>
  vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(init?.redirect).toBe('manual');
    expect(init?.method).toBe('GET');
    if (url.pathname === '/wp-json/')
      return (overrides.discovery ?? (() => json({ namespaces: ['oembed/1.0', 'wp/v2'] })))(url, init);
    if (url.pathname === '/wp-json/wp/v2/users/me')
      return (
        overrides.me ??
        (() =>
          json({
            capabilities: { edit_posts: true },
            id: 7,
            roles: ['editor'],
            username: 'binflow',
          }))
      )(url, init);
    if (url.pathname === '/wp-json/wp/v2/posts')
      return (
        overrides.posts ??
        (() =>
          json(
            [
              { id: 1, title: { raw: 'Hola &amp; bienvenidos' } },
              { id: 2, title: { rendered: '<em>Segundo</em> post&#8217;s' } },
            ],
            { headers: { 'x-wp-total': '42' } },
          ))
      )(url, init);
    if (url.pathname === '/wp-json/wp/v2/categories')
      return (
        overrides.categories ??
        (() => json([{ id: 3 }], { headers: { 'x-wp-total': '6' } }))
      )(url, init);
    return new Response('not found', { status: 404 });
  });

describe('WordPress credential verifier', () => {
  it('verifies an Editor with discovery, users/me and a read probe', async () => {
    const fetch = siteFetch();
    const verifier = createWordpressCredentialVerifier({ fetch });

    await expect(verifier.verify(createInput())).resolves.toEqual({
      authenticated: true,
      externalResourceId: 'blog.example.com',
      readProbe: {
        categoryCount: 6,
        latestPostTitles: ['Hola & bienvenidos', 'Segundo post’s'],
        postCount: 42,
      },
      restBase: `${ORIGIN}/wp-json/`,
      role: 'editor',
      siteOrigin: ORIGIN,
      userId: 7,
      username: 'binflow',
    });
    const meCall = fetch.mock.calls.find(([input]) =>
      String(input).includes('/users/me'),
    );
    expect(new Headers(meCall?.[1]?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`binflow:${FIXTURE_PASSWORD}`).toString('base64')}`,
    );
    const discoveryCall = fetch.mock.calls.find(
      ([input]) => new URL(String(input)).pathname === '/wp-json/',
    );
    expect(new Headers(discoveryCall?.[1]?.headers).has('authorization')).toBe(
      false,
    );
    expect(verifier.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });

  it('accepts Administrator with a risk warning', async () => {
    const verifier = createWordpressCredentialVerifier({
      fetch: siteFetch({
        me: () =>
          json({
            capabilities: { edit_posts: true },
            id: 1,
            roles: ['administrator'],
            username: 'binflow',
          }),
      }),
    });
    await expect(verifier.verify(createInput())).resolves.toMatchObject({
      riskWarning: 'administrator_role',
      role: 'administrator',
    });
  });

  it('rejects roles below Editor', async () => {
    const verifier = createWordpressCredentialVerifier({
      fetch: siteFetch({
        me: () =>
          json({
            capabilities: { edit_posts: true },
            id: 4,
            roles: ['author'],
            username: 'binflow',
          }),
      }),
    });
    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authorization_error',
      metadata: { code: 'wordpress_role_insufficient' },
    });
  });

  it('maps a rejected Application Password to authentication_error', async () => {
    const verifier = createWordpressCredentialVerifier({
      fetch: siteFetch({
        me: () => json({ code: 'rest_not_logged_in' }, { status: 401 }),
      }),
    });
    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authentication_error',
      metadata: { code: 'wordpress_auth_failed' },
    });
  });

  it('reports REST unavailable when discovery is blocked', async () => {
    const verifier = createWordpressCredentialVerifier({
      fetch: vi.fn(
        async () =>
          new Response('<html>blocked</html>', {
            headers: { 'content-type': 'text/html' },
            status: 200,
          }),
      ),
    });
    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'provider_final',
      metadata: { code: 'wordpress_rest_unavailable' },
    });
  });

  it('refuses cross-host redirects without re-sending the password', async () => {
    const fetch = siteFetch({
      me: () =>
        new Response(null, {
          headers: { location: 'https://evil.example.net/wp-json/wp/v2/users/me' },
          status: 302,
        }),
    });
    const verifier = createWordpressCredentialVerifier({ fetch });
    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'policy_denied',
      metadata: { code: 'wordpress_redirect_cross_host' },
    });
    expect(
      fetch.mock.calls.some(([input]) => String(input).includes('evil.example.net')),
    ).toBe(false);
  });

  it('rejects non-HTTPS site origins before any request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const verifier = createWordpressCredentialVerifier({
      allowInsecureLocalhost: false,
      fetch,
    });
    await expect(
      verifier.verify(
        createInput({}, { siteOrigin: 'http://blog.example.com', username: 'binflow' }),
      ),
    ).rejects.toMatchObject({
      category: 'validation_error',
      metadata: { code: 'wordpress_origin_insecure' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies timeouts as retryable after one retry', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const verifier = createWordpressCredentialVerifier({
      fetch,
      requestTimeoutMs: 20,
    });
    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'provider_retryable',
      metadata: { code: 'wordpress_timeout' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects non-project scope', async () => {
    const verifier = createWordpressCredentialVerifier({ fetch: vi.fn() });
    await expect(
      verifier.verify(
        createInput({ ownerScope: 'tenant', projectId: undefined }),
      ),
    ).rejects.toMatchObject({ category: 'policy_denied' });
  });
});

describe('WordPress REST client', () => {
  it('denies non-allowlisted routes such as plugins and users', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createWordpressRestClient({ fetch, siteOrigin: ORIGIN });
    for (const route of ['wp/v2/plugins', 'wp/v2/users', 'wp/v2/settings', 'wp/v2/themes']) {
      await expect(
        client.get(`${ORIGIN}/wp-json/`, route),
      ).rejects.toMatchObject({
        category: 'policy_denied',
        metadata: { code: 'wordpress_route_denied' },
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to ?rest_route= when pretty permalinks are off', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/wp-json/') return new Response('nope', { status: 404 });
      if (url.searchParams.get('rest_route') === '/')
        return json({ namespaces: ['wp/v2'] });
      if (url.searchParams.get('rest_route') === '/wp/v2/categories')
        return json([]);
      return new Response('nope', { status: 404 });
    });
    const client = createWordpressRestClient({ fetch, siteOrigin: ORIGIN });
    const discovery = await client.discover();
    expect(discovery.restBase).toBe(`${ORIGIN}/?rest_route=/`);
    await expect(
      client.get(discovery.restBase, 'wp/v2/categories', { per_page: '1' }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('follows same-origin redirects', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/wp-json/')
        return new Response(null, {
          headers: { location: '/index.php/wp-json/' },
          status: 301,
        });
      return json({ namespaces: ['wp/v2'] });
    });
    const client = createWordpressRestClient({ fetch, siteOrigin: ORIGIN });
    await expect(client.discover()).resolves.toMatchObject({
      namespaces: ['wp/v2'],
    });
  });
});

describe('normalizeWordpressSiteOrigin', () => {
  it('normalizes to a bare HTTPS origin', () => {
    expect(normalizeWordpressSiteOrigin('https://Blog.Example.com/')).toBe(
      'https://blog.example.com',
    );
  });

  it('rejects subdirectory installs and embedded credentials', () => {
    expect(() =>
      normalizeWordpressSiteOrigin('https://example.com/blog'),
    ).toThrow(/origin/u);
    expect(() =>
      normalizeWordpressSiteOrigin('https://user:pw@example.com'),
    ).toThrow(/credentials/u);
  });

  it('allows http://localhost only behind the development flag', () => {
    expect(() => normalizeWordpressSiteOrigin('http://localhost:8080')).toThrow(
      /HTTPS/u,
    );
    expect(
      normalizeWordpressSiteOrigin('http://localhost:8080', {
        allowInsecureLocalhost: true,
      }),
    ).toBe('http://localhost:8080');
  });

  it('strips markup and entities from titles', () => {
    expect(plainWordpressTitle('<b>Caf&eacute;</b> &amp; m&aacute;s')).toBe(
      'Caf&eacute; & m&aacute;s',
    );
  });
});
