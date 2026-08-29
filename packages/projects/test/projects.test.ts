import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ProjectManifest } from '@binflow/contracts';

import {
  assertProjectBundlePublishable,
  composeProjectRolFromFacts,
  extractProjectUrlPageText,
  mergeClosedFactsIntoProjectBundle,
  normalizeProjectBundleForManifest,
  portfolioCoverPublicPath,
  portfolioSectionHeadings,
  renderProjectArtifacts,
  resolveProjectUrlEvidence,
  slugifySpanish,
  toProjectCover,
  validateProjectBundleAgainstManifest,
  type ProjectGenerationPort,
} from '../src/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const loadManifest = async (name: string): Promise<ProjectManifest> =>
  JSON.parse(await readFile(join(fixtureRoot, name), 'utf8')) as ProjectManifest;

describe('@binflow/projects', () => {
  it('builds stable slugs from descriptors', () => {
    expect(slugifySpanish('Sitio headless para reserva de clases')).toBe(
      'sitio-headless-para-reserva-de-clases',
    );
  });

  it('renders bilingual markdown artifacts from Webbin manifest headings', async () => {
    const manifest = await loadManifest('webbin-manifest.json');
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    const files = await renderProjectArtifacts({ bundle, manifest });
    expect(files).toHaveLength(2);
    const en = new TextDecoder().decode(
      files.find((file) => file.path.endsWith('/proyectos/headless-language-class-booking-site.md'))
        ?.bytes ?? new Uint8Array(),
    );
    const es = new TextDecoder().decode(
      files.find(
        (file) =>
          file.path.endsWith('/proyectos-es/headless-language-class-booking-site.md'),
      )?.bytes ?? new Uint8Array(),
    );
    expect(en).toContain('## Challenge');
    expect(en).toContain('## Solution');
    expect(en).toContain('## Outcome');
    expect(es).toContain('## Reto');
    expect(es).toContain('## Solución');
    expect(es).toContain('## Resultado');
    expect(en).toContain('tipo: "Sitio web"');
  });

  it('renders architect manifest headings without Webbin-specific strings', async () => {
    const manifest = await loadManifest('minimal-architect-manifest.json');
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    const files = await renderProjectArtifacts({ bundle, manifest });
    const en = new TextDecoder().decode(
      files.find((file) =>
        file.path.endsWith('/projects/headless-language-class-booking-site.md'),
      )?.bytes ?? new Uint8Array(),
    );
    expect(en).toContain('## Brief');
    expect(en).toContain('## Design');
    expect(en).toContain('## Delivery');
    expect(en).not.toContain('## Challenge');
  });

  it('validates bundle enums and headings against manifest', async () => {
    const manifest = await loadManifest('webbin-manifest.json');
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    expect(() =>
      validateProjectBundleAgainstManifest(bundle, manifest),
    ).not.toThrow();
    expect(() =>
      validateProjectBundleAgainstManifest(
        {
          ...bundle,
          es: { ...bundle.es, tipo: 'Invalid tipo' },
        },
        manifest,
      ),
    ).toThrow(/Field tipo value is not allowed/);
  });

  it('normalizes enum accents and applies operator tipo or estado overrides', async () => {
    const manifest = await loadManifest('webbin-manifest.json');
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    const normalized = normalizeProjectBundleForManifest(
      {
        ...bundle,
        en: { ...bundle.en, tipo: 'Aplicación web' },
        es: { ...bundle.es, tipo: 'Aplicación web' },
      },
      manifest,
    );
    expect(normalized.es.tipo).toBe('Aplicacion web');
    expect(normalized.en.tipo).toBe('Aplicacion web');
    expect(
      normalizeProjectBundleForManifest(bundle, manifest, {
        brief: 'Brief',
        mode: 'brief',
        projectId: 'webbin',
        tipo: 'Landing page',
      }),
    ).toMatchObject({
      es: { tipo: 'Landing page' },
      en: { tipo: 'Landing page' },
    });
  });

  it('requires url when publication intent is publish', async () => {
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    expect(() =>
      assertProjectBundlePublishable({ ...bundle, url: undefined }, 'publish'),
    ).toThrow(/Publication intent requires a public url/);
    expect(() =>
      assertProjectBundlePublishable(bundle, 'publish'),
    ).not.toThrow();
  });

  it('exposes manifest-driven section headings per locale', async () => {
    const manifest = await loadManifest('minimal-architect-manifest.json');
    expect(portfolioSectionHeadings(manifest, 'en')).toEqual({
      challenge: 'Brief',
      outcome: 'Delivery',
      solution: 'Design',
    });
  });

  it('composes rol from design and migration flags', () => {
    expect(
      composeProjectRolFromFacts({
        didDesign: true,
        didMigration: true,
        roleExtras: 'SEO técnico',
      }),
    ).toBe('Desarrollo, diseño, migración, SEO técnico');
    expect(
      composeProjectRolFromFacts(
        {
          didDesign: false,
          didMigration: false,
        },
        'en',
      ),
    ).toBe('Development');
    expect(
      composeProjectRolFromFacts({
        didDesign: false,
        didMigration: false,
      }),
    ).toBe('Desarrollo');
  });

  it('merges closedFacts metadata and normalizes year-month fecha', async () => {
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    const merged = mergeClosedFactsIntoProjectBundle(
      {
        ...bundle,
        es: {
          ...bundle.es,
          clienteTipo: 'Not specified',
          descriptor: 'Not specified',
          impacto: 'Not specified placeholder that is long enough for schema.',
          industria: 'Not specified',
          resumen: 'Not specified',
          stack: ['Wrong'],
        },
        en: {
          ...bundle.en,
          clienteTipo: 'Not specified',
          descriptor: 'Not specified',
          impacto: 'Not specified placeholder that is long enough for schema.',
          industria: 'Not specified',
          resumen: 'Not specified',
          stack: ['Wrong'],
        },
      },
      {
        brief: 'x',
        closedFacts: {
          clienteTipo: 'Home care organisation',
          didDesign: true,
          didMigration: false,
          fecha: '2024-05',
          industria: 'Healthcare',
          impacto:
            'Reduced plugin surface and improved Core Web Vitals on mobile.',
          name: 'IAHA case study',
          projectDescription:
            'WordPress to Oxygen migration for a home-care organisation with verified performance gains.',
          stack: ['WordPress', 'Oxygen'],
        },
        mode: 'brief',
        projectId: 'webbin',
      },
    );
    expect(merged.fecha).toBe('2024-05-01');
    expect(merged.es.clienteTipo).toBe('Home care organisation');
    expect(merged.es.industria).toBe('Healthcare');
    expect(merged.es.stack).toEqual(['WordPress', 'Oxygen']);
    expect(merged.es.rol).toBe('Desarrollo, diseño');
    expect(merged.en.rol).toBe('Development, design');
    expect(merged.es.descriptor).toBe('IAHA case study');
    expect(merged.es.resumen).toMatch(/WordPress to Oxygen/);
  });

  it('ignores URL-poisoned stack and business metadata on merge', async () => {
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    const merged = mergeClosedFactsIntoProjectBundle(bundle, {
      brief: 'x',
      closedFacts: {
        clienteTipo: 'https://bistrozurlinde.ch',
        industria: 'https://bistrozurlinde.ch',
        stack: ['https://bistrozurlinde.ch'],
        url: 'https://bistrozurlinde.ch',
      },
      mode: 'brief',
      projectId: 'webbin',
    });
    expect(merged.url).toBe('https://bistrozurlinde.ch');
    expect(merged.es.stack).toEqual(bundle.es.stack);
    expect(merged.es.clienteTipo).toBe(bundle.es.clienteTipo);
    expect(merged.es.industria).toBe(bundle.es.industria);
  });

  it('encodes hero covers as AVIF under the manifest image directory', async () => {
    const manifest = await loadManifest('webbin-manifest.json');
    const bundle = JSON.parse(
      await readFile(join(fixtureRoot, 'typical-confidential.json'), 'utf8'),
    );
    const png = await (
      await import('sharp')
    ).default({
      create: {
        background: { r: 20, g: 40, b: 80 },
        channels: 3,
        height: 400,
        width: 800,
      },
    })
      .png()
      .toBuffer();
    const files = await renderProjectArtifacts({
      bundle: {
        ...bundle,
        imagen: portfolioCoverPublicPath(
          manifest.content.portfolio!.imageDirectory,
          bundle.slug,
        ),
      },
      imageSource: new Uint8Array(png),
      manifest,
    });
    const cover = files.find((file) => file.path.endsWith('.avif'));
    expect(cover?.mime).toBe('image/avif');
    expect(cover?.path).toBe(
      `public/images/projects/${bundle.slug as string}.avif`,
    );
    const encoded = await toProjectCover(new Uint8Array(png));
    expect(encoded.byteLength).toBeGreaterThan(100);
  });

  it('extracts title and og meta from thin SPA HTML shells', () => {
    const text = extractProjectUrlPageText(`<!doctype html>
<html><head>
<title>IAHA Home Care</title>
<meta property="og:description" content="In-home care scheduling and family portal for home care organisations." />
<meta name="description" content="Book trusted caregivers online." />
</head><body><div id="app"></div></body></html>`);
    expect(text).toMatch(/IAHA Home Care/);
    expect(text).toMatch(/In-home care scheduling/);
    expect(text.length).toBeGreaterThanOrEqual(40);
  });

  it('soft-degrades URL evidence when fetch fails but projectDescription exists', async () => {
    const generation = {
      extractUrlEvidence: async () => {
        throw new Error('should not be called');
      },
    } as unknown as ProjectGenerationPort;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND example.invalid');
    }) as typeof fetch;
    try {
      const evidence = await resolveProjectUrlEvidence({
        generation,
        request: {
          brief: 'name: Demo',
          closedFacts: {
            projectDescription:
              'WordPress to Oxygen migration for a home-care organisation with verified performance gains.',
            url: 'https://example.invalid/case',
          },
          mode: 'brief',
          projectId: 'webbin',
          url: 'https://example.invalid/case',
        },
      });
      expect(evidence).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails clearly when URL fetch fails and projectDescription is missing', async () => {
    const generation = {
      extractUrlEvidence: async () => {
        throw new Error('should not be called');
      },
    } as unknown as ProjectGenerationPort;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND example.invalid');
    }) as typeof fetch;
    try {
      await expect(
        resolveProjectUrlEvidence({
          generation,
          request: {
            brief: 'x',
            closedFacts: { url: 'https://example.invalid/case' },
            mode: 'brief',
            projectId: 'webbin',
            url: 'https://example.invalid/case',
          },
        }),
      ).rejects.toThrow(/projectDescription grounding/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
