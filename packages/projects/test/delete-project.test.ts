import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ProjectManifest } from '@binflow/contracts';

import {
  buildDeletionPaths,
  buildDeletionRoutes,
  parseSlugFromProjectUrl,
  resolveDeleteTarget,
  type CatalogItem,
} from '../src/delete-project.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const loadManifest = async (): Promise<ProjectManifest> => ({
  ...(JSON.parse(
    await readFile(join(fixtureRoot, 'webbin-manifest.json'), 'utf8'),
  ) as ProjectManifest),
  slugLocale: 'es',
  repository: {
    branchPattern: 'binflow/{capability}/{request-id}',
    productionBranch: 'main',
  },
});

const catalog: readonly CatalogItem[] = [
  {
    category: 'Sitio web',
    contentHash: 'abc',
    locale: 'es',
    slug: 'headless-language-class-booking-site',
    sourceId:
      'src/content/proyectos-es/headless-language-class-booking-site.md',
    sourceRevision: '1',
    title: 'Plataforma headless para reserva de clases',
  },
  {
    category: 'Sitio web',
    contentHash: 'def',
    locale: 'en',
    slug: 'headless-language-class-booking-site',
    sourceId: 'src/content/proyectos/headless-language-class-booking-site.md',
    sourceRevision: '1',
    title: 'Headless language class booking site',
  },
];

describe('delete project helpers', () => {
  it('builds manifest-driven deletion paths for bilingual Webbin portfolio', async () => {
    const manifest = await loadManifest();
    expect(
      buildDeletionPaths('headless-language-class-booking-site', manifest),
    ).toEqual([
      'public/images/projects/headless-language-class-booking-site.avif',
      'public/images/projects/headless-language-class-booking-site.jpg',
      'src/content/proyectos-es/headless-language-class-booking-site.md',
      'src/content/proyectos/headless-language-class-booking-site.md',
    ]);
  });

  it('builds routes for each portfolio collection', async () => {
    const manifest = await loadManifest();
    expect(
      buildDeletionRoutes('headless-language-class-booking-site', manifest),
    ).toEqual([
      '/proyectos/headless-language-class-booking-site',
      '/es/proyectos/headless-language-class-booking-site',
    ]);
  });

  it('parses slug from public URL using portfolio route prefixes', async () => {
    const manifest = await loadManifest();
    expect(
      parseSlugFromProjectUrl(
        'https://webbin.com.mx/es/proyectos/headless-language-class-booking-site',
        manifest,
      ),
    ).toBe('headless-language-class-booking-site');
  });

  it('resolves Spanish title to slug via catalog', async () => {
    const manifest = await loadManifest();
    const target = resolveDeleteTarget(catalog, manifest, {
      productionOrigin: 'https://webbin.com.mx',
      targetTitle: 'Plataforma headless para reserva de clases',
    });
    expect(target.resolvedSlug).toBe('headless-language-class-booking-site');
    expect(target.source).toBe('title');
  });

  it('rejects URL when slug is not in published catalog', async () => {
    const manifest = await loadManifest();
    expect(() =>
      resolveDeleteTarget(catalog, manifest, {
        productionOrigin: 'https://webbin.com.mx',
        targetUrl:
          'https://webbin.com.mx/es/proyectos/proyecto-eliminado',
      }),
    ).toThrow(/project/i);
  });
});
