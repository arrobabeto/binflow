import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '@binflow/domain';

import {
  WORDPRESS_BLOG_ROUTE_RULES,
  assertAllowedRoute,
  createWordpressBlogPublicationPort,
  escapeWordpressText,
  unescapeWordpressText,
  wordpressPostContentHash,
} from '../src/index.js';

const ORIGIN = 'https://blog.example.com';
const REST_BASE = `${ORIGIN}/wp-json/`;
const USER_ID = 7;

type StoredPost = {
  author: number;
  categories: number[];
  content: string;
  excerpt: string;
  featured_media: number;
  id: number;
  link: string;
  modified_gmt: string;
  password: string;
  slug: string;
  status: string;
  title: string;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

const asEdit = (post: StoredPost) => ({
  ...post,
  content: { raw: post.content, rendered: post.content },
  excerpt: { raw: post.excerpt },
  title: { raw: post.title },
});

/** Minimal in-memory WordPress REST site. */
const fakeSite = () => {
  const posts = new Map<number, StoredPost>();
  const media: { id: number; slug: string; source_url: string }[] = [];
  const categories = [
    { count: 3, id: 1, name: 'Uncategorized', slug: 'uncategorized' },
    { count: 2, id: 5, name: 'News', slug: 'news' },
  ];
  let nextId = 100;
  let clock = 0;
  const calls: { method: string; path: string; search: string }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/wp-json\//u, '');
    calls.push({ method, path, search: url.search });
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const postMatch = /^wp\/v2\/posts\/(\d+)$/u.exec(path);
    if (path === 'wp/v2/posts' && method === 'POST') {
      nextId += 1;
      clock += 1;
      const post: StoredPost = {
        author: USER_ID,
        categories: body.categories as number[],
        content: body.content as string,
        excerpt: body.excerpt as string,
        featured_media: body.featured_media as number,
        id: nextId,
        link: `${ORIGIN}/?p=${String(nextId)}`,
        modified_gmt: `2026-10-14T00:00:0${String(clock)}`,
        password: body.password as string,
        slug: `post-${String(nextId)}`,
        status: body.status as string,
        title: body.title as string,
      };
      posts.set(post.id, post);
      return json(asEdit(post), 201);
    }
    if (path === 'wp/v2/posts' && method === 'GET')
      return json([...posts.values()].filter((post) => post.status !== 'trash').map(asEdit));
    if (postMatch !== null) {
      const post = posts.get(Number(postMatch[1]));
      if (post === undefined) return json({ code: 'rest_post_invalid_id' }, 404);
      if (method === 'GET') {
        if (!init?.headers || !JSON.stringify(init.headers).includes('Basic'))
          return json({ content: { protected: post.password.length > 0, rendered: '' }, id: post.id });
        return json(asEdit(post));
      }
      if (method === 'POST') {
        clock += 1;
        Object.assign(post, body, { modified_gmt: `2026-10-14T00:01:0${String(clock)}` });
        return json(asEdit(post));
      }
      if (method === 'DELETE') {
        post.status = 'trash';
        return json(asEdit(post));
      }
    }
    if (path === 'wp/v2/categories' && method === 'GET') {
      const slug = url.searchParams.get('slug');
      return json(slug === null ? categories : categories.filter((row) => row.slug === slug), 200);
    }
    if (path === 'wp/v2/categories' && method === 'POST') {
      const row = { count: 0, id: 50, name: body.name as string, slug: body.slug as string };
      categories.push(row);
      return json(row, 201);
    }
    if (path === 'wp/v2/media' && method === 'GET') {
      const slug = url.searchParams.get('slug');
      return json(media.filter((row) => row.slug === slug));
    }
    if (path === 'wp/v2/media' && method === 'POST') {
      const disposition = JSON.stringify(init?.headers ?? {});
      const slug = /filename=\\?"?([a-z0-9-]+)\./u.exec(disposition)?.[1] ?? 'upload';
      const row = { id: 900 + media.length, slug, source_url: `${ORIGIN}/uploads/${slug}.png` };
      media.push(row);
      return json(row, 201);
    }
    if (/^wp\/v2\/media\/\d+$/u.test(path) && method === 'POST') return json({ id: 900 });
    return json({ code: 'rest_no_route' }, 404);
  });
  return { calls, categories, fetch, media, posts };
};

const portFor = (site: ReturnType<typeof fakeSite>) =>
  createWordpressBlogPublicationPort({
    applicationPassword: 'abcd efgh ijkl mnop qrst uvwx',
    fetch: site.fetch,
    restBase: REST_BASE,
    siteOrigin: ORIGIN,
    userId: USER_ID,
    username: 'binflow',
  });

const draft = {
  categories: [5],
  content: '<p>Hello</p>',
  excerpt: 'Summary',
  featuredMedia: 0,
  password: 'Pw23456789ab',
  title: 'Fish & Chips <b>',
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('WordPress blog route allowlist', () => {
  it('denies permanent deletes and unlisted routes', () => {
    expect(() =>
      assertAllowedRoute(WORDPRESS_BLOG_ROUTE_RULES, 'DELETE', 'wp/v2/posts/12', { force: 'true' }),
    ).toThrow(DomainError);
    expect(() =>
      assertAllowedRoute(WORDPRESS_BLOG_ROUTE_RULES, 'DELETE', 'wp/v2/categories/5', {}),
    ).toThrow(DomainError);
    expect(() =>
      assertAllowedRoute(WORDPRESS_BLOG_ROUTE_RULES, 'POST', 'wp/v2/users', {}),
    ).toThrow(DomainError);
    expect(() =>
      assertAllowedRoute(WORDPRESS_BLOG_ROUTE_RULES, 'POST', 'wp/v2/posts/12', {}),
    ).not.toThrow();
  });
});

describe('createWordpressBlogPublicationPort', () => {
  it('creates a password-protected post with escaped plain-text title', async () => {
    const site = fakeSite();
    const port = portFor(site);
    const snapshot = await port.createProtectedPost(draft);
    const stored = site.posts.get(snapshot.id);
    expect(stored?.status).toBe('publish');
    expect(stored?.password).toBe(draft.password);
    expect(stored?.title).toBe('Fish &amp; Chips &lt;b&gt;');
    expect(snapshot.title).toBe(draft.title);
    expect(snapshot.password).toBe(draft.password);
  });

  it('refuses to create or update a post without a password', async () => {
    const port = portFor(fakeSite());
    await expect(port.createProtectedPost({ ...draft, password: '' })).rejects.toMatchObject({
      category: 'policy_denied',
    });
    await expect(port.updateProtectedPost(1, { ...draft, password: '' })).rejects.toMatchObject({
      category: 'policy_denied',
    });
  });

  it('adopts only same-author protected posts with the exact title', async () => {
    const site = fakeSite();
    const port = portFor(site);
    const created = await port.createProtectedPost(draft);
    expect((await port.findAdoptablePost(draft.title))?.id).toBe(created.id);
    expect(await port.findAdoptablePost('Another title')).toBeUndefined();
    const stored = site.posts.get(created.id);
    if (stored !== undefined) stored.password = '';
    expect(await port.findAdoptablePost(draft.title)).toBeUndefined();
  });

  it('moves posts to trash without force and treats missing posts as gone', async () => {
    const site = fakeSite();
    const port = portFor(site);
    const created = await port.createProtectedPost(draft);
    expect(await port.trashPost(created.id)).toEqual({ alreadyGone: false });
    const deletes = site.calls.filter((call) => call.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.search).not.toContain('force');
    expect(await port.trashPost(created.id)).toEqual({ alreadyGone: true });
    expect(await port.trashPost(424242)).toEqual({ alreadyGone: true });
  });

  it('unlocks a post and reports public protection via anonymous REST', async () => {
    const site = fakeSite();
    const port = portFor(site);
    const created = await port.createProtectedPost(draft);
    expect(await port.isPublicContentProtected(created.id)).toBe(true);
    const unlocked = await port.unlockPost(created.id, [50]);
    expect(unlocked.password).toBe('');
    expect(unlocked.categories).toEqual([50]);
    expect(await port.isPublicContentProtected(created.id)).toBe(false);
  });

  it('reuses categories and media by slug on retry', async () => {
    const site = fakeSite();
    const port = portFor(site);
    expect((await port.findOrCreateCategory('News')).id).toBe(5);
    const created = await port.findOrCreateCategory('Recetas Nuevas');
    expect(created.slug).toBe('recetas-nuevas');
    expect((await port.findOrCreateCategory('Recetas Nuevas')).id).toBe(created.id);
    const first = await port.uploadMedia({ altText: 'Alt', bytes: PNG, mediaKey: 'binflow-req-1' });
    const second = await port.uploadMedia({ altText: 'Alt', bytes: PNG, mediaKey: 'binflow-req-1' });
    expect(second.id).toBe(first.id);
    expect(site.calls.filter((call) => call.method === 'POST' && call.path === 'wp/v2/media')).toHaveLength(1);
  });

  it('rejects non-image media bytes', async () => {
    const port = portFor(fakeSite());
    await expect(
      port.uploadMedia({ altText: '', bytes: new Uint8Array([1, 2, 3, 4]), mediaKey: 'x-1' }),
    ).rejects.toMatchObject({ category: 'validation_error' });
  });
});

describe('content hash and text escaping', () => {
  it('round-trips plain text and binds the hash to written fields', () => {
    expect(unescapeWordpressText(escapeWordpressText('A & B <c> "d"'))).toBe('A & B <c> "d"');
    const base = { categories: [2, 1], content: 'x', excerpt: 'e', featuredMedia: 0, title: 't' };
    expect(wordpressPostContentHash(base)).toBe(
      wordpressPostContentHash({ ...base, categories: [1, 2] }),
    );
    expect(wordpressPostContentHash(base)).not.toBe(
      wordpressPostContentHash({ ...base, content: 'y' }),
    );
  });
});
