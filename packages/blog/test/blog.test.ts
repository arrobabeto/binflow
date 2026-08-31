import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import type { ProjectManifest } from '@binflow/contracts';

import {
  BlogExecutor,
  assertGeneratedBundleMatchesContentLocales,
  blogPreviewRoutes,
  buildBlogGenerateLocaleInstructions,
  decideCategory,
  decideSemanticSimilarity,
  decideSimilarity,
  detectDominantContentLocale,
  orbitypeBlogPublicationStages,
  orbitypePostTitleSlug,
  renderWebbinArtifacts,
  slugifySpanish,
  type BlogGenerationPort,
  type CatalogItem,
  type ContentCatalogPort,
  type DeploymentPort,
  type RepositoryPublicationPort,
} from '../src/index.js';

const manifest = {
  content: {
    editablePaths: [
      'src/content/articulos/*.md',
      'src/content/articulos-es/*.md',
      'public/images/articles/*.avif',
    ],
  },
  contentLocales: ['es', 'en'],
  conversationLocale: 'es',
  defaultContentLocale: 'es',
  repository: {
    branchPattern: 'bot/webbin/{capability}/{request-id}-{slug}',
  },
  translationPolicy: 'always_translate',
} as ProjectManifest;

const catalogItems: CatalogItem[] = [
  {
    category: 'Web App',
    contentHash: 'a'.repeat(64),
    locale: 'es',
    slug: 'automatizar-operaciones',
    sourceId: 'one',
    sourceRevision: 'sha',
    title: 'Cómo automatizar operaciones de una empresa',
  },
];

const bundle = {
  category: 'Web App',
  categoryKind: 'existing' as const,
  en: {
    body: '# Practical guide\n\n' + 'Useful English content. '.repeat(40),
    categoria: 'Web App',
    descripcion:
      'A practical guide to automating repeatable work safely in a small company.',
    faq: [
      {
        pregunta: 'What should start first?',
        respuesta: 'Start with a measured process.',
      },
      {
        pregunta: 'Is review required?',
        respuesta: 'Yes, keep human approval.',
      },
    ],
    imagenAlt: 'An operations team reviewing a connected automation workflow',
    keywords: ['automation', 'operations', 'small business'],
    seoTitulo: 'Safe automation for small business operations',
    tiempoLectura: 7,
    titulo: 'How to automate small business operations safely',
  },
  es: {
    body: '# Guía práctica\n\n' + 'Contenido útil en español. '.repeat(40),
    categoria: 'Web App',
    descripcion:
      'Una guía práctica para automatizar trabajo repetible con seguridad en una pequeña empresa.',
    faq: [
      {
        pregunta: '¿Qué se automatiza primero?',
        respuesta: 'Empieza por un proceso medible.',
      },
      {
        pregunta: '¿Se necesita revisión?',
        respuesta: 'Sí, conserva la aprobación humana.',
      },
    ],
    imagenAlt:
      'Un equipo de operaciones revisando un flujo de automatización conectado',
    keywords: ['automatización', 'operaciones', 'pequeñas empresas'],
    seoTitulo: 'Automatización segura para pequeñas empresas',
    tiempoLectura: 7,
    titulo: 'Cómo automatizar operaciones de una pequeña empresa',
  },
  imagePrompt:
    'Editorial illustration of a small operations team coordinating a safe automation workflow',
  rationale: {
    evidenceRefs: [],
    limitations: [],
    summary: 'Practical introduction.',
  },
  slug: 'placeholder',
};

describe('blog policy and rendering', () => {
  it('normalizes slugs, category typos and overlap deterministically', () => {
    expect(slugifySpanish('Cómo diseñar IA útil')).toBe('como-disenar-ia-util');
    expect(decideCategory('web  app', catalogItems)).toMatchObject({
      kind: 'existing',
    });
    expect(decideCategory('Web Ap', catalogItems)).toMatchObject({
      kind: 'likely_typo',
    });
    expect(decideCategory('SOP', catalogItems)).toEqual({
      category: 'SOP',
      kind: 'new',
    });
    expect(
      decideSimilarity(
        {
          mode: 'brief',
          projectId: 'project',
          topic: 'Cómo automatizar operaciones de una empresa',
        },
        catalogItems,
      ).level,
    ).toBe('high_overlap');
    expect(
      decideSemanticSimilarity(catalogItems, [
        [1, 0],
        [0.91, 0.01],
      ]).level,
    ).toBe('high_overlap');
  });

  it('renders exactly two Markdown files and one real AVIF', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const files = await renderWebbinArtifacts({
      bundle: { ...bundle, slug: 'automatizacion-segura' },
      imageSource: png,
      manifest,
      publicationDate: '2026-08-18',
    });
    expect(files.map((file) => file.path)).toEqual([
      'src/content/articulos-es/automatizacion-segura.md',
      'src/content/articulos/automatizacion-segura.md',
      'public/images/articles/automatizacion-segura.avif',
    ]);
    expect((await sharp(files[2]?.bytes).metadata()).format).toBe('heif');
  });

  it('builds Orbitype preview routes from CMS draft ids', () => {
    const orbitypeManifest = {
      content: {
        collections: {
          de: { directory: 'src/content/blog-de', routePrefix: '/posts' },
        },
        source: 'orbitype',
      },
      contentLocales: ['de'],
      profile: 'astro_orbitype',
    } as ProjectManifest;
    expect(
      blogPreviewRoutes(orbitypeManifest, 'eroeffnung', {
        orbitypeDrafts: [
          { draftId: 'bfde01a05219', titleSlug: 'eroeffnung-bistro' },
        ],
      }),
    ).toEqual(['/posts/bfde01a05219/eroeffnung-bistro']);
  });

  it('slugifies titles like Bistro production post URLs', () => {
    expect(
      orbitypePostTitleSlug(
        'Saisonale Menükarte: Herbstgenuss in der Linde',
      ),
    ).toBe('saisonale-men-karte-herbstgenuss-in-der-linde');
    expect(
      blogPreviewRoutes(
        {
          content: { source: 'orbitype' },
          contentLocales: ['de'],
          profile: 'astro_orbitype',
        } as ProjectManifest,
        'ignored',
        {
          orbitypeDrafts: [
            {
              draftId: 'Gbw787',
              titleSlug: orbitypePostTitleSlug(
                'Saisonale Menükarte: Herbstgenuss in der Linde',
              ),
            },
          ],
        },
      ),
    ).toEqual([
      '/posts/Gbw787/saisonale-men-karte-herbstgenuss-in-der-linde',
    ]);
  });

  it('renders monolingual Orbitype blog paths inside editablePath globs', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const orbitypeManifest = {
      content: {
        collections: {
          de: { directory: 'src/content/blog-de', routePrefix: '/de' },
        },
        editablePaths: [
          'cms/collections/**',
          'src/content/blog-de/*.md',
          'public/images/blog/*.avif',
        ],
        imageDirectory: 'public/images/blog',
        source: 'orbitype',
      },
      contentLocales: ['de'],
      profile: 'astro_orbitype',
      repository: {
        branchPattern: 'bot/bistro/{capability}/{request-id}-{slug}',
      },
    } as ProjectManifest;
    const files = await renderWebbinArtifacts({
      bundle: { ...bundle, slug: 'eroeffnung-bistro' },
      imageSource: png,
      manifest: orbitypeManifest,
      publicationDate: '2026-08-30',
    });
    expect(files.map((file) => file.path)).toEqual([
      'src/content/blog-de/eroeffnung-bistro.md',
      'public/images/blog/eroeffnung-bistro.avif',
    ]);
  });

  it('accepts legacy **/ globs for files directly under a collection', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const orbitypeManifest = {
      content: {
        collections: {
          de: { directory: 'src/content/blog-de', routePrefix: '/de' },
        },
        editablePaths: [
          'src/content/blog-de/**/*.md',
          'public/images/blog/*.avif',
        ],
        imageDirectory: 'public/images/blog',
        source: 'orbitype',
      },
      contentLocales: ['de'],
      profile: 'astro_orbitype',
      repository: {
        branchPattern: 'bot/bistro/{capability}/{request-id}-{slug}',
      },
    } as ProjectManifest;
    await expect(
      renderWebbinArtifacts({
        bundle: { ...bundle, slug: 'eroeffnung-bistro' },
        imageSource: png,
        manifest: orbitypeManifest,
        publicationDate: '2026-08-30',
      }),
    ).resolves.toHaveLength(2);
  });

  it('rejects an English bundle that copies Spanish titles', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    await expect(
      renderWebbinArtifacts({
        bundle: {
          ...bundle,
          en: {
            ...bundle.en,
            seoTitulo: bundle.es.seoTitulo,
            titulo: bundle.es.titulo,
          },
          slug: 'automatizacion-segura',
        },
        imageSource: png,
        manifest,
        publicationDate: '2026-08-18',
      }),
    ).rejects.toThrow(/idiomatic adaptation/u);
  });
});

describe('complete fake-provider workflow', () => {
  it('binds preview, approval input and production to exact SHAs', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const catalog: ContentCatalogPort = {
      async sync() {
        return { items: catalogItems, revision: 'catalog-sha' };
      },
    };
    const generation: BlogGenerationPort = {
      async embed() {
        return [
          [1, 0],
          [0.6, 0.8],
        ];
      },
      async generate() {
        return bundle;
      },
      async generateImage() {
        return png;
      },
      async interpretRevision() {
        throw new Error('interpretRevision not used in this test');
      },
      async applyRevisionPatch() {
        throw new Error('applyRevisionPatch not used in this test');
      },
      async proposeTopic({ context }) {
        return context.trim().slice(0, 500);
      },
    };
    const repository: RepositoryPublicationPort = {
      async createDraft(input) {
        return {
          baseCommitSha: 'base-sha',
          branch: input.branch,
          files: input.files.map((file) => file.path),
          headCommitSha: 'preview-sha',
          pullRequestId: '42',
          pullRequestUrl: 'https://github.test/pull/42',
        };
      },
      async merge() {
        return { mergeCommitSha: 'merge-sha' };
      },
      async revalidate(input) {
        expect(input.expectedHeadSha).toBe('preview-sha');
      },
      async readFileAtRef() {
        return null;
      },
    };
    const deployments: DeploymentPort = {
      async waitForPreview(input) {
        return {
          deploymentId: 'preview-1',
          environment: 'preview',
          readyAt: new Date().toISOString(),
          sha: input.headCommitSha,
          urls: Object.fromEntries(
            input.routes.map((route) => [
              route,
              `https://preview.test${route}`,
            ]),
          ),
        };
      },
      async waitForProduction(input) {
        return {
          deploymentId: 'production-1',
          environment: 'production',
          readyAt: new Date().toISOString(),
          sha: input.mergeCommitSha,
          urls: Object.fromEntries(
            input.routes.map((route) => [route, `https://webbin.test${route}`]),
          ),
        };
      },
      async verifyAbsence() {
        throw new Error('unused');
      },
      async verifyDeletionRedirects() {
        throw new Error('unused');
      },
    };
    const executor = new BlogExecutor(
      catalog,
      generation,
      repository,
      deployments,
    );
    const result = await executor.execute({
      input: {
        category: 'Web App',
        mode: 'brief',
        projectId: 'project',
        topic: 'Automatización segura para pequeñas empresas',
      },
      manifest,
      requestId: 'request',
      requestVersionId: 'version',
    });
    expect(result.deployment.sha).toBe(result.publication.headCommitSha);
    expect(result.intent).toBe('Automatización segura para pequeñas empresas');
    const published = await executor.publish({
      deploymentId: result.deployment.deploymentId,
      expectedFiles: result.publication.files,
      headCommitSha: result.publication.headCommitSha,
      previewSha: result.deployment.sha,
      pullRequestId: result.publication.pullRequestId,
      routes: Object.keys(result.deployment.urls),
    });
    expect(published).toMatchObject({ mergeCommitSha: 'merge-sha' });
  });

  it('binds Orbitype preview to /posts/{draftId}/{titleSlug}', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const orbitypeManifest = {
      content: {
        collections: {
          de: { directory: 'src/content/blog-de', routePrefix: '/posts' },
        },
        editablePaths: [
          'src/content/blog-de/*.md',
          'public/images/blog/*.avif',
        ],
        imageDirectory: 'public/images/blog',
        publicationTargets: ['github', 'orbitype'],
        source: 'orbitype',
      },
      contentLocales: ['de'],
      conversationLocale: 'es',
      defaultContentLocale: 'de',
      profile: 'astro_orbitype',
      repository: {
        branchPattern: 'bot/bistro/{capability}/{request-id}-{slug}',
      },
      translationPolicy: 'none',
    } as ProjectManifest;
    const germanBundle = {
      ...bundle,
      category: 'Gastronomie',
      categoryKind: 'new' as const,
      en: {
        ...bundle.en,
        categoria: 'Gastronomie',
        titulo: 'Seasonal menu: autumn flavors at the Linde',
        seoTitulo: 'Seasonal autumn menu at Restaurant zur Linde',
      },
      es: {
        body:
          '# Saisonale Menükarte\n\n' +
          'Wir freuen uns und begrüßen Sie herzlich mit der Speisekarte. '.repeat(
            20,
          ),
        categoria: 'Gastronomie',
        descripcion:
          'Die saisonale Menükarte bringt Herbstgenuss und Willkommen in unser Restaurant an der Linde.',
        faq: [
          {
            pregunta: 'Wann haben Sie geöffnet?',
            respuesta: 'Wir sind heute und morgen für Sie da.',
          },
          {
            pregunta: 'Gibt es eine Speisekarte?',
            respuesta: 'Ja, die saisonale Speisekarte liegt bereit.',
          },
        ],
        imagenAlt: 'Herbstliche Speisekarte im Restaurant zur Linde',
        keywords: ['menükarte', 'herbst', 'restaurant'],
        seoTitulo: 'Saisonale Menükarte und Herbstgenuss in der Linde',
        tiempoLectura: 5,
        titulo: 'Saisonale Menükarte: Herbstgenuss in der Linde',
      },
      slug: 'saisonale-men-karte-herbstgenuss-in-der-linde',
    };
    const stages: string[] = [];
    let previewRoutes: readonly string[] = [];
    const catalog: ContentCatalogPort = {
      async sync() {
        return { items: [], revision: 'catalog-sha' };
      },
    };
    const generation: BlogGenerationPort = {
      async embed() {
        return [[1, 0]];
      },
      async generate() {
        return germanBundle;
      },
      async generateImage() {
        return png;
      },
      async interpretRevision() {
        throw new Error('unused');
      },
      async applyRevisionPatch() {
        throw new Error('unused');
      },
      async proposeTopic() {
        throw new Error('unused');
      },
    };
    const repository: RepositoryPublicationPort = {
      async createDraft(input) {
        return {
          baseCommitSha: 'base-sha',
          branch: input.branch,
          files: input.files.map((file) => file.path),
          headCommitSha: 'preview-sha',
          pullRequestId: '21',
          pullRequestUrl: 'https://github.test/bistro/pull/21',
        };
      },
      async merge() {
        return { mergeCommitSha: 'merge-sha' };
      },
      async revalidate() {},
      async readFileAtRef() {
        return null;
      },
    };
    const deployments: DeploymentPort = {
      async waitForPreview(input) {
        previewRoutes = input.routes;
        return {
          deploymentId: 'preview-1',
          environment: 'preview',
          readyAt: new Date().toISOString(),
          sha: input.headCommitSha,
          urls: Object.fromEntries(
            input.routes.map((route) => [
              route,
              `https://preview.test${route}`,
            ]),
          ),
        };
      },
      async waitForProduction() {
        throw new Error('unused');
      },
      async verifyAbsence() {
        throw new Error('unused');
      },
      async verifyDeletionRedirects() {
        throw new Error('unused');
      },
    };
    const result = await new BlogExecutor(
      catalog,
      generation,
      repository,
      deployments,
    ).execute({
      input: {
        category: 'Gastronomie',
        mode: 'draft',
        projectId: 'bistro',
        topic: 'Herbstkarte',
      },
      manifest: orbitypeManifest,
      onStage: async (node) => {
        stages.push(node);
      },
      orbitype: {
        async createDraft(input) {
          return {
            draftId: 'Gbw787',
            locale: input.locale,
            slug: input.slug,
          };
        },
      },
      publicationStages: orbitypeBlogPublicationStages,
      requestId: 'request',
      requestVersionId: 'version',
    });
    expect(stages).toContain('create_github_draft');
    expect(stages).toContain('create_orbitype_draft');
    expect(stages).toContain('wait_preview');
    expect(previewRoutes).toEqual([
      '/posts/Gbw787/saisonale-men-karte-herbstgenuss-in-der-linde',
    ]);
    expect(result.orbitypeDrafts?.[0]?.draftId).toBe('Gbw787');
    expect(result.deployment.urls[previewRoutes[0]!]).toContain(
      '/posts/Gbw787/',
    );
  });

  it('refines topic from context before similarity', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const stages: string[] = [];
    let refined: string | undefined;
    const catalog: ContentCatalogPort = {
      async sync() {
        return { items: catalogItems, revision: 'catalog-sha' };
      },
    };
    const generation: BlogGenerationPort = {
      async embed() {
        return [
          [1, 0],
          [0.6, 0.8],
        ];
      },
      async generate() {
        return bundle;
      },
      async generateImage() {
        return png;
      },
      async interpretRevision() {
        throw new Error('interpretRevision not used in this test');
      },
      async applyRevisionPatch() {
        throw new Error('applyRevisionPatch not used in this test');
      },
      async proposeTopic({ context }) {
        expect(context).toContain('detalle largo');
        return 'Automatización de blogs con agents';
      },
    };
    const repository: RepositoryPublicationPort = {
      async createDraft(input) {
        return {
          baseCommitSha: 'base-sha',
          branch: input.branch,
          files: input.files.map((file) => file.path),
          headCommitSha: 'preview-sha',
          pullRequestId: '42',
          pullRequestUrl: 'https://github.test/pull/42',
        };
      },
      async merge() {
        return { mergeCommitSha: 'merge-sha' };
      },
      async revalidate() {},
      async readFileAtRef() {
        return null;
      },
    };
    const deployments: DeploymentPort = {
      async waitForPreview(input) {
        return {
          deploymentId: 'preview-1',
          environment: 'preview',
          readyAt: new Date().toISOString(),
          sha: input.headCommitSha,
          urls: Object.fromEntries(
            input.routes.map((route) => [
              route,
              `https://preview.test${route}`,
            ]),
          ),
        };
      },
      async waitForProduction(input) {
        return {
          deploymentId: 'production-1',
          environment: 'production',
          readyAt: new Date().toISOString(),
          sha: input.mergeCommitSha,
          urls: Object.fromEntries(
            input.routes.map((route) => [route, `https://webbin.test${route}`]),
          ),
        };
      },
      async verifyAbsence() {
        throw new Error('unused');
      },
      async verifyDeletionRedirects() {
        throw new Error('unused');
      },
    };
    const executor = new BlogExecutor(
      catalog,
      generation,
      repository,
      deployments,
    );
    const longContext = `Quiero un blog sobre agents. ${'detalle largo '.repeat(40)}`;
    const result = await executor.execute({
      input: {
        context: longContext,
        mode: 'brief',
        projectId: 'project',
        topic: 'Tema por definir desde tu mensaje',
      },
      manifest,
      onStage: async (node) => {
        stages.push(node);
      },
      onTopicRefined: async (topic) => {
        refined = topic;
      },
      requestId: 'request',
      requestVersionId: 'version',
    });
    expect(stages.indexOf('interpret_brief')).toBeGreaterThan(
      stages.indexOf('catalog_sync'),
    );
    expect(stages.indexOf('interpret_brief')).toBeLessThan(
      stages.indexOf('similarity'),
    );
    expect(refined).toBe('Automatización de blogs con agents');
    expect(result.intent).toBe('Automatización de blogs con agents');
  });
});

describe('content locale contract enforcement', () => {
  const germanContract = {
    contentLocales: ['de'] as const,
    conversationLocale: 'es',
    defaultContentLocale: 'de',
    translationPolicy: 'none',
  };

  const germanPrimary = {
    body:
      '# Willkommen in der Linde\n\n' +
      'Wir freuen uns und begrüßen Sie herzlich im Restaurant. '.repeat(20),
    categoria: 'Gastro',
    descripcion:
      'Ein herzlicher Dank und Willkommen für Gäste in unserem Restaurant an der Linde.',
    faq: [
      {
        pregunta: 'Wann haben Sie geöffnet?',
        respuesta: 'Wir sind heute und morgen für Sie da.',
      },
      {
        pregunta: 'Gibt es eine Speisekarte?',
        respuesta: 'Ja, die saisonale Speisekarte liegt bereit.',
      },
    ],
    imagenAlt: 'Gedeckter Tisch im Restaurant zur Linde bei Tageslicht',
    keywords: ['restaurant', 'linde', 'willkommen'],
    seoTitulo: 'Willkommen und Danke im Restaurant zur Linde',
    tiempoLectura: 5,
    titulo: 'Wir haben geöffnet — herzlich willkommen und danke',
  };

  it('builds hard constraints that forbid conversation-language articles', () => {
    const text = buildBlogGenerateLocaleInstructions(germanContract);
    expect(text).toMatch(/HARD CONSTRAINT/u);
    expect(text).toMatch(/German/u);
    expect(text).toMatch(/contentLocales=\[de\]/u);
    expect(text).toMatch(/conversationLocale=es/u);
  });

  it('detects Spanish vs German primary prose', () => {
    expect(detectDominantContentLocale(bundle.es.body)).toBe('es');
    expect(detectDominantContentLocale(germanPrimary.body)).toBe('de');
  });

  it('accepts German primary for DE-only enrollment', () => {
    expect(() =>
      assertGeneratedBundleMatchesContentLocales(
        {
          ...bundle,
          es: germanPrimary,
          en: {
            ...bundle.en,
            titulo: 'Welcome and thanks at Restaurant zur Linde',
            seoTitulo: 'Welcome note for Restaurant zur Linde guests',
          },
        },
        germanContract,
      ),
    ).not.toThrow();
  });

  it('rejects Spanish primary when contentLocales are only de', () => {
    expect(() =>
      assertGeneratedBundleMatchesContentLocales(bundle, germanContract),
    ).toThrow(/contentLocales|German|detected es|conversation/iu);
  });

  it('renders only blog-de for monolingual Orbitype manifests', async () => {
    const png = await sharp({
      create: { background: '#182030', channels: 3, height: 768, width: 1024 },
    })
      .png()
      .toBuffer();
    const files = await renderWebbinArtifacts({
      bundle: {
        ...bundle,
        es: germanPrimary,
        slug: 'willkommen-und-danke',
      },
      imageSource: png,
      manifest: {
        content: {
          collections: {
            de: { directory: 'src/content/blog-de', routePrefix: '/posts' },
          },
          editablePaths: [
            'src/content/blog-de/*.md',
            'public/images/blog/*.avif',
          ],
          imageDirectory: 'public/images/blog',
          source: 'orbitype',
        },
        contentLocales: ['de'],
        profile: 'astro_orbitype',
      } as ProjectManifest,
      publicationDate: '2026-08-30',
    });
    expect(files.map((file) => file.path)).toEqual([
      'src/content/blog-de/willkommen-und-danke.md',
      'public/images/blog/willkommen-und-danke.avif',
    ]);
    const markdown = new TextDecoder().decode(files[0]!.bytes);
    expect(markdown).toMatch(/Willkommen|Restaurant|herzlich/u);
    expect(markdown).not.toMatch(/Cómo automatizar/u);
  });
});
