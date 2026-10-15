import { createHash } from 'node:crypto';

import { DomainError } from '@binflow/domain';

import {
  createWordpressRestClient,
  type WordpressRouteRule,
} from './client.js';
import { plainWordpressTitle } from './verifier.js';

/**
 * Exact REST surface of `create_blog_wordpress` (ADR-0067). Anything else,
 * including permanent deletes (`force`), is refused by the client.
 */
export const WORDPRESS_BLOG_ROUTE_RULES: readonly WordpressRouteRule[] =
  Object.freeze([
    { method: 'GET', pattern: /^wp\/v2\/categories$/u },
    { method: 'GET', pattern: /^wp\/v2\/posts$/u },
    { method: 'GET', pattern: /^wp\/v2\/posts\/\d+$/u },
    { method: 'GET', pattern: /^wp\/v2\/media$/u },
    { method: 'GET', pattern: /^wp\/v2\/users\/me$/u },
    { method: 'POST', pattern: /^wp\/v2\/posts$/u },
    { method: 'POST', pattern: /^wp\/v2\/posts\/\d+$/u },
    { method: 'POST', pattern: /^wp\/v2\/media$/u },
    { method: 'POST', pattern: /^wp\/v2\/media\/\d+$/u },
    { method: 'POST', pattern: /^wp\/v2\/categories$/u },
    { method: 'DELETE', pattern: /^wp\/v2\/posts\/\d+$/u },
  ]);

export const WORDPRESS_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type WordpressCategory = Readonly<{
  count: number;
  id: number;
  name: string;
  slug: string;
}>;

export type WordpressPostSnapshot = Readonly<{
  authorId: number;
  categories: readonly number[];
  content: string;
  excerpt: string;
  featuredMedia: number;
  id: number;
  link: string;
  modifiedGmt: string;
  password: string;
  slug: string;
  status: string;
  title: string;
}>;

export type WordpressPostDraft = Readonly<{
  categories: readonly number[];
  content: string;
  excerpt: string;
  featuredMedia: number;
  password: string;
  title: string;
}>;

export type WordpressImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const rawField = (value: unknown): string => {
  const field = record(value);
  if (typeof field.raw === 'string') return field.raw;
  if (typeof field.rendered === 'string') return field.rendered;
  return typeof value === 'string' ? value : '';
};

/** Title/excerpt are plain text; escaped on write so they never carry markup. */
export const escapeWordpressText = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

export const unescapeWordpressText = (value: string): string =>
  value
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#0?39;/gu, "'")
    .replace(/&amp;/gu, '&');

const parsePost = (json: unknown): WordpressPostSnapshot => {
  const post = record(json);
  if (typeof post.id !== 'number' || typeof post.link !== 'string')
    throw new DomainError(
      'provider_final',
      'WordPress returned an unexpected post shape.',
      { code: 'wordpress_unexpected_shape' },
    );
  return {
    authorId: typeof post.author === 'number' ? post.author : 0,
    categories: Array.isArray(post.categories)
      ? post.categories.filter((id): id is number => typeof id === 'number')
      : [],
    content: rawField(post.content),
    excerpt: unescapeWordpressText(rawField(post.excerpt)),
    featuredMedia:
      typeof post.featured_media === 'number' ? post.featured_media : 0,
    id: post.id,
    link: post.link,
    modifiedGmt: typeof post.modified_gmt === 'string' ? post.modified_gmt : '',
    password: typeof post.password === 'string' ? post.password : '',
    slug: typeof post.slug === 'string' ? post.slug : '',
    status: typeof post.status === 'string' ? post.status : '',
    title: unescapeWordpressText(rawField(post.title)),
  };
};

/** Hash of the fields Binflow writes; approvals bind to it (ADR-0067). */
export const wordpressPostContentHash = (
  post: Pick<
    WordpressPostSnapshot,
    'categories' | 'content' | 'excerpt' | 'featuredMedia' | 'title'
  >,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        categories: [...post.categories].sort((a, b) => a - b),
        content: post.content,
        excerpt: post.excerpt,
        featuredMedia: post.featuredMedia,
        title: post.title,
      }),
    )
    .digest('hex');

export const detectWordpressImageMime = (
  bytes: Uint8Array,
): WordpressImageMime | undefined => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png';
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return undefined;
};

const extensionForMime: Readonly<Record<WordpressImageMime, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const slugifyWordpressTerm = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);

export type WordpressBlogPublicationPortOptions = Readonly<{
  applicationPassword: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  restBase: string;
  siteOrigin: string;
  userId: number;
  username: string;
}>;

export const createWordpressBlogPublicationPort = (
  options: WordpressBlogPublicationPortOptions,
) => {
  const client = createWordpressRestClient({
    allowedRoutes: WORDPRESS_BLOG_ROUTE_RULES,
    auth: {
      applicationPassword: options.applicationPassword,
      username: options.username,
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    siteOrigin: options.siteOrigin,
  });
  const { restBase } = options;

  const getPost = async (id: number): Promise<WordpressPostSnapshot> =>
    parsePost(
      (await client.get(restBase, `wp/v2/posts/${String(id)}`, { context: 'edit' }))
        .json,
    );

  const postBody = (draft: WordpressPostDraft) => ({
    categories: [...draft.categories],
    content: draft.content,
    excerpt: escapeWordpressText(draft.excerpt),
    featured_media: draft.featuredMedia,
    password: draft.password,
    status: 'publish',
    title: escapeWordpressText(draft.title),
  });

  return {
    async listCategories(): Promise<readonly WordpressCategory[]> {
      const categories: WordpressCategory[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const { headers, json } = await client.get(restBase, 'wp/v2/categories', {
          _fields: 'id,name,slug,count',
          page: String(page),
          per_page: '100',
        });
        if (!Array.isArray(json)) break;
        for (const item of json) {
          const row = record(item);
          if (typeof row.id !== 'number' || typeof row.name !== 'string') continue;
          categories.push({
            count: typeof row.count === 'number' ? row.count : 0,
            id: row.id,
            name: plainWordpressTitle(row.name),
            slug: typeof row.slug === 'string' ? row.slug : '',
          });
        }
        const totalPages = Number(headers.get('x-wp-totalpages') ?? '1');
        if (!Number.isFinite(totalPages) || page >= totalPages) break;
      }
      return categories;
    },

    getPost,

    /**
     * Adopt a post a previous attempt created (crash between POST and the
     * Binflow checkpoint): same author, password-protected, exact title.
     */
    async findAdoptablePost(title: string): Promise<WordpressPostSnapshot | undefined> {
      const { json } = await client.get(restBase, 'wp/v2/posts', {
        author: String(options.userId),
        context: 'edit',
        orderby: 'date',
        per_page: '20',
        search: title.slice(0, 80),
        status: 'publish',
      });
      if (!Array.isArray(json)) return undefined;
      return json
        .map((item) => parsePost(item))
        .find(
          (post) =>
            post.authorId === options.userId &&
            post.password.length > 0 &&
            post.title === title,
        );
    },

    async createProtectedPost(draft: WordpressPostDraft): Promise<WordpressPostSnapshot> {
      if (draft.password.length === 0)
        throw new DomainError(
          'policy_denied',
          'A preview post must be password protected.',
          { code: 'wordpress_preview_not_protected' },
        );
      return parsePost(
        (
          await client.send('POST', restBase, 'wp/v2/posts', {
            body: { json: postBody(draft), kind: 'json' },
          })
        ).json,
      );
    },

    async updateProtectedPost(
      id: number,
      draft: WordpressPostDraft,
    ): Promise<WordpressPostSnapshot> {
      if (draft.password.length === 0)
        throw new DomainError(
          'policy_denied',
          'A preview post must be password protected.',
          { code: 'wordpress_preview_not_protected' },
        );
      await client.send('POST', restBase, `wp/v2/posts/${String(id)}`, {
        body: { json: postBody(draft), kind: 'json' },
      });
      return getPost(id);
    },

    /** Remove the preview password (publication) and optionally set categories. */
    async unlockPost(
      id: number,
      categories?: readonly number[],
    ): Promise<WordpressPostSnapshot> {
      await client.send('POST', restBase, `wp/v2/posts/${String(id)}`, {
        body: {
          json: {
            password: '',
            ...(categories === undefined ? {} : { categories: [...categories] }),
          },
          kind: 'json',
        },
      });
      return getPost(id);
    },

    /** Move to trash (never `force`). Missing posts count as already removed. */
    async trashPost(id: number): Promise<Readonly<{ alreadyGone: boolean }>> {
      try {
        const current = await getPost(id);
        if (current.status === 'trash') return { alreadyGone: true };
        await client.send('DELETE', restBase, `wp/v2/posts/${String(id)}`);
        return { alreadyGone: false };
      } catch (error) {
        if (
          error instanceof DomainError &&
          (error.metadata.status === '404' || error.metadata.status === '410')
        )
          return { alreadyGone: true };
        throw error;
      }
    },

    async findOrCreateCategory(name: string): Promise<WordpressCategory> {
      const slug = slugifyWordpressTerm(name);
      const { json } = await client.get(restBase, 'wp/v2/categories', {
        _fields: 'id,name,slug,count',
        slug,
      });
      const existing = Array.isArray(json) ? record(json[0]) : {};
      if (typeof existing.id === 'number')
        return {
          count: typeof existing.count === 'number' ? existing.count : 0,
          id: existing.id,
          name: plainWordpressTitle(
            typeof existing.name === 'string' ? existing.name : name,
          ),
          slug,
        };
      const created = record(
        (
          await client.send('POST', restBase, 'wp/v2/categories', {
            body: { json: { name, slug }, kind: 'json' },
          })
        ).json,
      );
      if (typeof created.id !== 'number')
        throw new DomainError(
          'provider_final',
          'WordPress returned an unexpected category shape.',
          { code: 'wordpress_unexpected_shape' },
        );
      return { count: 0, id: created.id, name, slug };
    },

    /** Upload once per media key; a retry reuses the existing attachment. */
    async uploadMedia(
      input: Readonly<{
        altText: string;
        bytes: Uint8Array;
        mediaKey: string;
      }>,
    ): Promise<Readonly<{ id: number; sourceUrl: string }>> {
      if (input.bytes.byteLength === 0 || input.bytes.byteLength > WORDPRESS_IMAGE_MAX_BYTES)
        throw new DomainError(
          'validation_error',
          'Image must be at most 10 MB.',
          { code: 'wordpress_image_invalid' },
        );
      const mime = detectWordpressImageMime(input.bytes);
      if (mime === undefined)
        throw new DomainError(
          'validation_error',
          'Image must be JPEG, PNG or WebP.',
          { code: 'wordpress_image_invalid' },
        );
      const slug = slugifyWordpressTerm(input.mediaKey);
      const { json } = await client.get(restBase, 'wp/v2/media', {
        _fields: 'id,source_url,slug',
        slug,
      });
      const existing = Array.isArray(json) ? record(json[0]) : {};
      if (typeof existing.id === 'number' && typeof existing.source_url === 'string')
        return { id: existing.id, sourceUrl: existing.source_url };
      const created = record(
        (
          await client.send('POST', restBase, 'wp/v2/media', {
            body: {
              bytes: input.bytes,
              filename: `${slug}.${extensionForMime[mime]}`,
              kind: 'binary',
              mime,
            },
          })
        ).json,
      );
      if (typeof created.id !== 'number' || typeof created.source_url !== 'string')
        throw new DomainError(
          'provider_final',
          'WordPress returned an unexpected media shape.',
          { code: 'wordpress_unexpected_shape' },
        );
      if (input.altText.trim().length > 0)
        await client.send('POST', restBase, `wp/v2/media/${String(created.id)}`, {
          body: { json: { alt_text: input.altText.slice(0, 250) }, kind: 'json' },
        });
      return { id: created.id, sourceUrl: created.source_url };
    },

    /** Download an image already hosted on the enrolled site. */
    async downloadSiteImage(url: string): Promise<Uint8Array> {
      const response = await client.fetchPublic(url, WORDPRESS_IMAGE_MAX_BYTES);
      if (response.status !== 200)
        throw new DomainError(
          'validation_error',
          'The image URL did not return an image.',
          { code: 'wordpress_image_invalid', status: String(response.status) },
        );
      if (detectWordpressImageMime(response.bytes) === undefined)
        throw new DomainError(
          'validation_error',
          'Image must be JPEG, PNG or WebP.',
          { code: 'wordpress_image_invalid' },
        );
      return response.bytes;
    },

    /** What a visitor without the password sees via REST. */
    async isPublicContentProtected(id: number): Promise<boolean> {
      const { json } = await client.getAnonymous(
        restBase,
        `wp/v2/posts/${String(id)}`,
        { _fields: 'id,content' },
      );
      return record(record(json).content).protected === true;
    },

    async publicPageStatus(link: string): Promise<number> {
      return (await client.fetchPublic(link, 4 * 1024 * 1024)).status;
    },
  };
};

export type WordpressBlogPublicationPort = ReturnType<
  typeof createWordpressBlogPublicationPort
>;
