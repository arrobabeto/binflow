import { describe, expect, it } from 'vitest';

import { createBlogWordpressInputSchema } from '@binflow/contracts';

import {
  capabilityIngressRoutes,
  composeAsIsHtml,
  isSiteImageUrl,
  isWordpressBlogCollectionAction,
  matchExistingCategoryName,
  nextWordpressBlogStep,
  resolveCapabilityRuntime,
  splitAsIsTitle,
  suggestWordpressCategories,
  WORDPRESS_AS_IS_MIN_BODY_CHARS,
} from '../src/index.js';

const LONG_BODY = 'Palabra '.repeat(WORDPRESS_AS_IS_MIN_BODY_CHARS / 4).trim();

const collect = (overrides: Record<string, unknown> = {}) => {
  const parsed = createBlogWordpressInputSchema.parse({
    collectionStep: 'choose_mode',
    content: '',
    excerptSkipped: false,
    mode: 'collect',
    projectId: 'project-demo',
    suggestedCategories: [],
    ...overrides,
  });
  if (parsed.mode !== 'collect') throw new Error('expected collect input');
  return parsed;
};

describe('splitAsIsTitle', () => {
  it('extracts a markdown heading or a Title: prefix', () => {
    expect(splitAsIsTitle('# Mi receta\n\nCuerpo')).toEqual({ body: 'Cuerpo', title: 'Mi receta' });
    expect(splitAsIsTitle('Título: Mi receta\nCuerpo')).toEqual({ body: 'Cuerpo', title: 'Mi receta' });
    expect(splitAsIsTitle('Sin título\nCuerpo')).toEqual({ body: 'Sin título\nCuerpo' });
  });
});

describe('composeAsIsHtml', () => {
  it('keeps every word and escapes HTML', () => {
    const text =
      'Primer párrafo con **negrita** & <script>alert(1)</script>.\n\n## Sección\n\n- uno\n- dos\n\n1. a\n2. b';
    const html = composeAsIsHtml(text);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong>negrita</strong>');
    expect(html).toContain('<h2>Sección</h2>');
    expect(html).toContain('<li>uno</li>');
    const words = (value: string) =>
      value
        .replace(/^(#+|-|\d+\.)\s/gmu, ' ')
        .replace(/\*\*/gu, '')
        .split(/\s+/u)
        .filter(Boolean);
    const htmlText = html
      .replace(/<[^>]+>/gu, '\n')
      .replace(/&lt;/gu, '<')
      .replace(/&gt;/gu, '>')
      .replace(/&amp;/gu, '&');
    expect(words(htmlText)).toEqual(words(text));
  });
});

describe('nextWordpressBlogStep', () => {
  it('walks the as-is interview gaps in order', () => {
    expect(nextWordpressBlogStep(collect())).toBe('choose_mode');
    expect(nextWordpressBlogStep(collect({ blogMode: 'as_is', content: 'corto' }))).toBe(
      'await_content',
    );
    expect(nextWordpressBlogStep(collect({ blogMode: 'as_is', content: LONG_BODY }))).toBe(
      'await_title',
    );
    expect(
      nextWordpressBlogStep(collect({ blogMode: 'as_is', content: LONG_BODY, title: 'Título' })),
    ).toBe('await_excerpt');
    expect(
      nextWordpressBlogStep(
        collect({ blogMode: 'as_is', content: LONG_BODY, excerptSkipped: true, title: 'Título' }),
      ),
    ).toBe('choose_category');
  });

  it('needs only base information in generate mode before category and image', () => {
    const base = { blogMode: 'generate', content: 'Información base suficiente para generar.' };
    expect(nextWordpressBlogStep(collect(base))).toBe('choose_category');
    expect(
      nextWordpressBlogStep(collect({ ...base, category: { id: 5, kind: 'existing', name: 'News' } })),
    ).toBe('choose_image');
    expect(
      nextWordpressBlogStep(
        collect({
          ...base,
          category: { kind: 'new', name: 'Recetas' },
          image: { source: 'ai' },
        }),
      ),
    ).toBe('ready');
  });
});

describe('category helpers', () => {
  const categories = [
    { count: 9, id: 1, name: 'Uncategorized', slug: 'uncategorized' },
    { count: 2, id: 5, name: 'Recetas de cocina', slug: 'recetas' },
    { count: 7, id: 6, name: 'Noticias', slug: 'noticias' },
  ];

  it('ranks matching categories first and hides uncategorized', () => {
    const suggested = suggestWordpressCategories(categories, 'Una receta de cocina mexicana');
    expect(suggested.map((row) => row.id)).toEqual([5, 6]);
  });

  it('matches an existing category name ignoring case and accents', () => {
    expect(matchExistingCategoryName(categories, 'NOTÍCIAS')?.id).toBe(6);
    expect(matchExistingCategoryName(categories, 'Viajes')).toBeUndefined();
  });
});

describe('isSiteImageUrl', () => {
  it('accepts only same-origin URLs without credentials', () => {
    const origin = 'https://blog.example.com';
    expect(isSiteImageUrl('https://blog.example.com/wp-content/a.png', origin)).toBe(true);
    expect(isSiteImageUrl('https://evil.example.com/a.png', origin)).toBe(false);
    expect(isSiteImageUrl('http://blog.example.com/a.png', origin)).toBe(false);
    expect(isSiteImageUrl('https://u:p@blog.example.com/a.png', origin)).toBe(false);
    expect(isSiteImageUrl('not a url', origin)).toBe(false);
  });
});

describe('create_blog_wordpress wiring', () => {
  it('routes the blog command to a dedicated handler and runtime', () => {
    const route = capabilityIngressRoutes.find(
      (candidate) => candidate.capabilityId === 'create_blog_wordpress',
    );
    expect(route?.handlerKind).toBe('wordpress_blog');
    expect(resolveCapabilityRuntime('create_blog_wordpress').kind).toBe('wordpress_blog');
  });

  it('recognises only the WordPress collection actions', () => {
    expect(isWordpressBlogCollectionAction('pick_wp_blog_mode:as_is')).toBe(true);
    expect(isWordpressBlogCollectionAction('wp_blog_skip_excerpt')).toBe(true);
    expect(isWordpressBlogCollectionAction('approve_preview')).toBe(false);
    expect(isWordpressBlogCollectionAction('pick_text_locale:es')).toBe(false);
  });

  it('rejects execute input without category or image', () => {
    expect(() =>
      createBlogWordpressInputSchema.parse({
        blogMode: 'generate',
        content: 'Base',
        mode: 'execute',
        projectId: 'project-demo',
        revisionNotes: [],
      }),
    ).toThrow();
  });
});
