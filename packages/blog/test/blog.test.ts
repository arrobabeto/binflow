import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import type { ProjectManifest } from '@binflow/contracts';

import {
  BlogExecutor,
  decideCategory,
  decideSemanticSimilarity,
  decideSimilarity,
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
  repository: {
    branchPattern: 'bot/webbin/{capability}/{request-id}-{slug}',
  },
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
