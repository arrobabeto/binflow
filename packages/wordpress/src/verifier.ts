import { DomainError } from '@binflow/domain';
import {
  type CredentialVerifier,
  type CredentialVerifierInput,
  type VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';
import { z } from 'zod';

import {
  allowInsecureWordpressLocalhost,
  createWordpressRestClient,
  normalizeWordpressSiteOrigin,
} from './client.js';

/** Discovery + users/me + two probe reads, each with one possible retry. */
export const WORDPRESS_VERIFY_TIMEOUT_MS = 150_000;
const MAX_PROBE_TITLES = 5;
const MAX_TITLE_CHARS = 160;

const secretSchema = z
  .object({
    applicationPassword: z.string().min(16).max(200),
  })
  .strict();

const configurationSchema = z
  .object({
    siteOrigin: z.string().min(1).max(500),
    username: z.string().trim().min(1).max(120),
  })
  .strict();

const userSchema = z.object({
  capabilities: z.record(z.string(), z.unknown()).optional(),
  id: z.number().int().positive(),
  roles: z.array(z.string()).default([]),
  slug: z.string().optional(),
  username: z.string().optional(),
});

const postsSchema = z.array(
  z.object({
    title: z
      .object({ raw: z.string().optional(), rendered: z.string().optional() })
      .partial()
      .optional(),
  }),
);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  rdquo: '”',
  rsquo: '’',
};

export const plainWordpressTitle = (value: string): string =>
  value
    .replaceAll(/<[^>]*>/gu, '')
    .replaceAll(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replaceAll(/&#x([0-9a-f]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replaceAll(/&([a-z]+);/giu, (match, name: string) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match,
    )
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_TITLE_CHARS);

const totalFromHeaders = (headers: Headers, fallback: number): number => {
  const value = Number.parseInt(headers.get('x-wp-total') ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const resolveRole = (
  roles: readonly string[],
): 'administrator' | 'editor' | undefined => {
  if (roles.includes('administrator')) return 'administrator';
  if (roles.includes('editor')) return 'editor';
  return undefined;
};

/**
 * Read-only `wordpress-api` verification (ADR-0066): REST discovery, identity
 * and role (Editor or Administrator with `edit_posts`), then a read probe of
 * posts and categories. Never mutates WordPress content.
 */
export const createWordpressCredentialVerifier = (
  options: Readonly<{
    allowInsecureLocalhost?: boolean;
    fetch?: typeof globalThis.fetch;
    requestTimeoutMs?: number;
  }> = {},
): CredentialVerifier => ({
  kinds: ['wordpress-api'],
  timeoutMs: WORDPRESS_VERIFY_TIMEOUT_MS,
  async verify(input: CredentialVerifierInput): Promise<VerificationEvidence> {
    if (
      input.credential.ownerScope !== 'project' ||
      input.credential.projectId === undefined ||
      input.credential.tenantId === undefined
    )
      throw new DomainError(
        'policy_denied',
        'WordPress credentials must be project-scoped.',
      );

    let configuration: z.infer<typeof configurationSchema>;
    try {
      configuration = configurationSchema.parse(input.credential.configuration);
      if (input.credential.connection?.configuration !== undefined)
        configurationSchema.parse(input.credential.connection.configuration);
    } catch {
      throw new DomainError(
        'validation_error',
        'WordPress credential configuration is invalid.',
      );
    }
    if (input.credential.connection?.projectId === undefined)
      throw new DomainError(
        'validation_error',
        'WordPress credential is missing its project binding.',
      );

    const siteOrigin = normalizeWordpressSiteOrigin(configuration.siteOrigin, {
      allowInsecureLocalhost:
        options.allowInsecureLocalhost ?? allowInsecureWordpressLocalhost(),
    });

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
          'WordPress credential payload is invalid.',
        );
      }

      const shared = {
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(options.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: options.requestTimeoutMs }),
        signal: input.signal,
        siteOrigin,
      };
      const discovery = await createWordpressRestClient(shared).discover();
      if (!discovery.namespaces.includes('wp/v2'))
        throw new DomainError(
          'provider_final',
          'WordPress REST API does not expose wp/v2.',
          { code: 'wordpress_rest_unavailable' },
        );

      const client = createWordpressRestClient({
        ...shared,
        auth: {
          applicationPassword: secret.applicationPassword,
          username: configuration.username,
        },
      });

      const me = userSchema.safeParse(
        (await client.get(discovery.restBase, 'wp/v2/users/me', {
          context: 'edit',
        })).json,
      );
      if (!me.success)
        throw new DomainError(
          'provider_final',
          'WordPress returned an unexpected user payload.',
          { code: 'wordpress_rest_unavailable' },
        );
      const role = resolveRole(me.data.roles);
      if (role === undefined || me.data.capabilities?.edit_posts !== true)
        throw new DomainError(
          'authorization_error',
          'WordPress user must be an Editor or Administrator who can edit posts.',
          { code: 'wordpress_role_insufficient' },
        );
      const verifiedUsername = me.data.username ?? configuration.username;
      if (
        verifiedUsername.toLowerCase() !== configuration.username.toLowerCase()
      )
        throw new DomainError(
          'policy_denied',
          'WordPress Application Password belongs to a different user.',
          { code: 'wordpress_username_mismatch' },
        );

      const posts = await client.get(discovery.restBase, 'wp/v2/posts', {
        _fields: 'id,title',
        context: 'edit',
        per_page: String(MAX_PROBE_TITLES),
        status: 'publish,draft',
      });
      const postRows = postsSchema.safeParse(posts.json);
      if (!postRows.success)
        throw new DomainError(
          'provider_final',
          'WordPress returned an unexpected posts payload.',
          { code: 'wordpress_rest_unavailable' },
        );
      const categories = await client.get(
        discovery.restBase,
        'wp/v2/categories',
        { _fields: 'id', per_page: '20' },
      );
      const categoryRows = Array.isArray(categories.json)
        ? categories.json.length
        : 0;

      const latestPostTitles = postRows.data
        .map((post) =>
          plainWordpressTitle(post.title?.raw ?? post.title?.rendered ?? ''),
        )
        .filter((title) => title.length > 0)
        .slice(0, MAX_PROBE_TITLES);

      return {
        authenticated: true,
        externalResourceId: new URL(siteOrigin).host,
        readProbe: {
          categoryCount: totalFromHeaders(categories.headers, categoryRows),
          latestPostTitles,
          postCount: totalFromHeaders(posts.headers, postRows.data.length),
        },
        restBase: discovery.restBase,
        ...(role === 'administrator'
          ? { riskWarning: 'administrator_role' as const }
          : {}),
        role,
        siteOrigin,
        userId: me.data.id,
        username: verifiedUsername,
      };
    } finally {
      plaintext.fill(0);
    }
  },
});
