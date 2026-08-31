import { describe, expect, it } from 'vitest';

import type { ProjectManifest } from '@binflow/contracts';

import {
  buildDeletionPaths,
  buildDeletionRoutes,
  parseSlugFromBlogUrl,
  resolveDeleteBlogProductionOrigin,
  resolveDeleteTarget,
} from '../src/delete-blog.js';
import type { CatalogItem } from '../src/index.js';

const manifest = {
  content: {
    collections: {
      en: {
        directory: 'src/content/articulos',
        routePrefix: '/articulos',
      },
      es: {
        directory: 'src/content/articulos-es',
        routePrefix: '/es/articulos',
      },
    },
    editablePaths: [
      'src/content/articulos/*.md',
      'src/content/articulos-es/*.md',
      'public/images/articles/*.avif',
    ],
    imageDirectory: 'public/images/articles',
    portfolio: {
      collections: {
        en: {
          directory: 'src/content/proyectos',
          routePrefix: '/proyectos',
        },
        es: {
          directory: 'src/content/proyectos-es',
          routePrefix: '/es/proyectos',
        },
      },
    },
  },
  repository: {
    branchPattern: 'binflow/{capability}/{request-id}',
    productionBranch: 'main',
  },
  slugLocale: 'es',
} as unknown as ProjectManifest;

const catalog: readonly CatalogItem[] = [
  {
    category: 'SEO',
    contentHash: 'abc',
    locale: 'es',
    slug: 'mi-articulo',
    sourceId: 'src/content/articulos-es/mi-articulo.md',
    sourceRevision: '1',
    title: 'Mi Artículo',
  },
];

describe('delete blog helpers', () => {
  it('builds manifest-driven deletion paths for bilingual Webbin', () => {
    expect(buildDeletionPaths('mi-articulo', manifest)).toEqual([
      'public/images/articles/mi-articulo.avif',
      'src/content/articulos-es/mi-articulo.md',
      'src/content/articulos/mi-articulo.md',
    ]);
  });

  it('builds routes for each manifest collection', () => {
    expect(buildDeletionRoutes('mi-articulo', manifest)).toEqual([
      '/articulos/mi-articulo',
      '/es/articulos/mi-articulo',
    ]);
  });

  it('parses slug from public URL using manifest route prefixes', () => {
    expect(
      parseSlugFromBlogUrl(
        'https://webbin.com.mx/es/articulos/mi-articulo',
        manifest,
      ),
    ).toBe('mi-articulo');
  });

  it('resolves title to slug via catalog', () => {
    const target = resolveDeleteTarget(catalog, manifest, {
      productionOrigin: 'https://webbin.com.mx',
      targetTitle: 'Mi Artículo',
    });
    expect(target.resolvedSlug).toBe('mi-articulo');
    expect(target.source).toBe('title');
  });

  it('resolves URL only when slug is in published catalog', () => {
    const target = resolveDeleteTarget(catalog, manifest, {
      productionOrigin: 'https://webbin.com.mx',
      targetUrl: 'https://webbin.com.mx/es/articulos/mi-articulo',
    });
    expect(target.resolvedSlug).toBe('mi-articulo');
    expect(target.source).toBe('url');
  });

  it('rejects URL when slug is not in published catalog', () => {
    expect(() =>
      resolveDeleteTarget(catalog, manifest, {
        productionOrigin: 'https://webbin.com.mx',
        targetUrl: 'https://webbin.com.mx/es/articulos/eliminado',
      }),
    ).toThrow(/article/i);
  });

  it('resolves English title when manifest slugLocale is es', () => {
    const bilingualCatalog: readonly CatalogItem[] = [
      {
        category: 'SEO',
        contentHash: 'abc',
        locale: 'en',
        slug: 'como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph',
        sourceId:
          'src/content/articulos/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.md',
        sourceRevision: '1',
        title: 'How Agentic-Node Web Apps Work with LangGraph',
      },
      {
        category: 'SEO',
        contentHash: 'def',
        locale: 'es',
        slug: 'como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph',
        sourceId:
          'src/content/articulos-es/como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph.md',
        sourceRevision: '1',
        title: 'Cómo funcionan las web apps con nodos agénticos en LangGraph',
      },
    ];
    const target = resolveDeleteTarget(bilingualCatalog, manifest, {
      productionOrigin: 'https://webbin.com.mx',
      targetTitle: 'How Agentic-Node Web Apps Work with LangGraph',
    });
    expect(target.resolvedSlug).toBe(
      'como-funcionan-las-web-apps-con-nodos-agenticos-en-langgraph',
    );
    expect(target.source).toBe('title');
  });

  it('resolves URL slug from any locale entry in catalog', () => {
    const bilingualCatalog: readonly CatalogItem[] = [
      {
        category: 'SEO',
        contentHash: 'abc',
        locale: 'en',
        slug: 'mi-articulo',
        sourceId: 'src/content/articulos/mi-articulo.md',
        sourceRevision: '1',
        title: 'My Article',
      },
    ];
    const target = resolveDeleteTarget(bilingualCatalog, manifest, {
      productionOrigin: 'https://webbin.com.mx',
      targetUrl: 'https://webbin.com.mx/es/articulos/mi-articulo',
    });
    expect(target.resolvedSlug).toBe('mi-articulo');
  });

  it('rejects title when no published match', () => {
    expect(() =>
      resolveDeleteTarget(catalog, manifest, {
        productionOrigin: 'https://webbin.com.mx',
        targetTitle: 'Artículo inexistente',
      }),
    ).toThrow(/article/i);
  });
});

describe('resolveDeleteBlogProductionOrigin', () => {
  it('falls back to the Webbin pilot when origin is omitted', () => {
    expect(resolveDeleteBlogProductionOrigin(null)).toBe(
      'https://webbin.com.mx',
    );
    expect(resolveDeleteBlogProductionOrigin(manifest)).toBe(
      'https://webbin.com.mx',
    );
  });

  it('uses frozen manifest productionOrigin', () => {
    expect(
      resolveDeleteBlogProductionOrigin({
        ...manifest,
        deployment: {
          previewMode: 'git_integration',
          productionOrigin: 'https://www.bistrozurlinde.ch/',
          projectId: 'prj',
          protectionMode: 'vercel_auth',
          provider: 'vercel',
        },
      }),
    ).toBe('https://www.bistrozurlinde.ch');
  });

  it('requires productionOrigin for astro_orbitype', () => {
    expect(() =>
      resolveDeleteBlogProductionOrigin({
        ...manifest,
        profile: 'astro_orbitype',
        deployment: {
          previewMode: 'git_integration',
          projectId: 'prj',
          protectionMode: 'vercel_auth',
          provider: 'vercel',
        },
      }),
    ).toThrow(/productionOrigin/i);
  });
});
