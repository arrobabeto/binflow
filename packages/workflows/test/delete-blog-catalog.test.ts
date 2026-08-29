import { describe, expect, it } from 'vitest';

import type { ProjectManifest } from '@binflow/contracts';
import type { CatalogItem } from '@binflow/blog';

import { filterBlogCatalogItems } from '../src/delete-blog-catalog.js';

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
    portfolio: {
      collections: {
        en: {
          directory: 'src/content/proyectos',
          routePrefix: '/proyectos',
        },
      },
    },
  },
} as unknown as ProjectManifest;

const items: readonly CatalogItem[] = [
  {
    category: 'SEO',
    contentHash: 'a',
    locale: 'es',
    slug: 'blog-post',
    sourceId: 'src/content/articulos-es/blog-post.md',
    sourceRevision: '1',
    title: 'Blog',
  },
  {
    category: 'Tech',
    contentHash: 'b',
    locale: 'es',
    slug: 'project-case',
    sourceId: 'src/content/proyectos/project-case.md',
    sourceRevision: '1',
    title: 'Project',
  },
];

describe('filterBlogCatalogItems', () => {
  it('keeps only manifest blog collection paths', () => {
    expect(filterBlogCatalogItems(items, manifest)).toEqual([items[0]]);
  });
});
