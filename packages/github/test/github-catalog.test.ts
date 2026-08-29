import type { ProjectManifest } from '@binflow/contracts';
import { describe, expect, it } from 'vitest';

import { resolveGitHubCatalogDirectories } from '../src/index.js';

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
        es: {
          directory: 'src/content/proyectos-es',
          routePrefix: '/es/proyectos',
        },
      },
    },
  },
} as ProjectManifest;

describe('resolveGitHubCatalogDirectories', () => {
  it('returns blog directories only when contentKinds is blog', () => {
    expect(resolveGitHubCatalogDirectories(manifest, ['blog'])).toEqual([
      {
        kind: 'blog',
        locale: 'en',
        prefix: 'src/content/articulos/',
      },
      {
        kind: 'blog',
        locale: 'es',
        prefix: 'src/content/articulos-es/',
      },
    ]);
  });

  it('returns portfolio directories only when contentKinds is portfolio', () => {
    expect(resolveGitHubCatalogDirectories(manifest, ['portfolio'])).toEqual([
      {
        kind: 'portfolio',
        locale: 'en',
        prefix: 'src/content/proyectos/',
      },
      {
        kind: 'portfolio',
        locale: 'es',
        prefix: 'src/content/proyectos-es/',
      },
    ]);
  });
});
