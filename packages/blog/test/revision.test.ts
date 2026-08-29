import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { GeneratedBlogBundle, RevisionPlan } from '@binflow/contracts';

import {
  applyDeterministicRevisionOps,
  BlogExecutor,
  type BlogGenerationPort,
  type ContentCatalogPort,
  type DeploymentPort,
  type RepositoryPublicationPort,
} from '../src/index.js';

const priorBundle = {
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
  slug: 'como-automatizar-operaciones-de-una-pequena-empresa',
} satisfies GeneratedBlogBundle;

const titlePlan: RevisionPlan = {
  localesAffected: ['es', 'en'],
  magnitude: 'title_locales',
  operations: [
    {
      locale: 'es',
      op: 'set_title',
      seoTitulo: 'Títulos más atractivos para operaciones seguras',
      titulo: 'Automatiza operaciones sin perder el control',
    },
    {
      locale: 'en',
      op: 'set_title',
      seoTitulo: 'More compelling titles for safe operations',
      titulo: 'Automate operations without losing control',
    },
  ],
  preservesSlug: true,
  rationale: 'Client asked for a more attractive title only.',
  requiresFullRegeneration: false,
  summary:
    'Actualizaré solo los títulos ES/EN. El cuerpo y la imagen se conservan.',
};

describe('surgical revision', () => {
  it('applies title_locales without changing body or image prompt', () => {
    const next = applyDeterministicRevisionOps(priorBundle, titlePlan);
    expect(next.es.body).toBe(priorBundle.es.body);
    expect(next.en.body).toBe(priorBundle.en.body);
    expect(next.imagePrompt).toBe(priorBundle.imagePrompt);
    expect(next.es.titulo).toBe('Automatiza operaciones sin perder el control');
    expect(next.en.titulo).toBe('Automate operations without losing control');
    expect(next.slug).toBe(priorBundle.slug);
  });

  it('preserves cover digest for title-only surgical apply', async () => {
    const priorImage = await sharp({
      create: {
        background: { r: 20, g: 40, b: 80 },
        channels: 3,
        height: 32,
        width: 48,
      },
    })
      .png()
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
    const priorDigest = createHash('sha256').update(priorImage).digest('hex');
    let imageCalls = 0;
    const generation: BlogGenerationPort = {
      async embed() {
        return [];
      },
      async generate() {
        throw new Error('full generate must not run');
      },
      async generateImage() {
        imageCalls += 1;
        return new Uint8Array([9, 9, 9]);
      },
      async interpretRevision() {
        return titlePlan;
      },
      async applyRevisionPatch() {
        throw new Error('AI patch must not run for set_title');
      },
      async proposeTopic() {
        return 'unused';
      },
    };
    const catalog: ContentCatalogPort = {
      async sync() {
        return { items: [], revision: 'rev' };
      },
    };
    const repository: RepositoryPublicationPort = {
      async createDraft(input) {
        return {
          baseCommitSha: 'base',
          branch: input.branch,
          files: input.files.map((file) => file.path),
          headCommitSha: 'head-rev',
          pullRequestId: '7',
          pullRequestUrl: 'https://github.test/pull/7',
        };
      },
      async merge() {
        return { mergeCommitSha: 'merge' };
      },
      async revalidate() {},
      async readFileAtRef() {
        return null;
      },
    };
    const deployments: DeploymentPort = {
      async waitForPreview(input) {
        return {
          deploymentId: 'd1',
          environment: 'preview',
          readyAt: new Date().toISOString(),
          sha: input.headCommitSha,
          urls: Object.fromEntries(
            input.routes.map((route) => [route, `https://p.test${route}`]),
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
    const executor = new BlogExecutor(
      catalog,
      generation,
      repository,
      deployments,
    );
    const result = await executor.applySurgicalRevision({
      priorBundle,
      priorImage,
      plan: titlePlan,
      publicationDate: '2026-08-21',
      manifest: {
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
      } as never,
      requestId: 'req-1',
      requestVersionId: 'ver-2',
    });
    expect(imageCalls).toBe(0);
    expect(result.bundle.es.body).toBe(priorBundle.es.body);
    expect(createHash('sha256').update(result.image).digest('hex')).toBe(
      priorDigest,
    );
    expect(result.bundle.slug).toBe(priorBundle.slug);
  });

  it('routes body_patch magnitude through the LLM patch port', async () => {
    let patched = false;
    const plan: RevisionPlan = {
      localesAffected: ['es', 'en'],
      magnitude: 'body_patch',
      operations: [
        {
          instruction:
            'Elimina la frase meta sobre la solicitud/noticia de marca de agua.',
          locale: 'es',
          op: 'patch_body',
        },
        {
          instruction: 'Remove the watermark request sentence.',
          locale: 'en',
          op: 'patch_body',
        },
      ],
      preservesSlug: true,
      rationale: 'Client asked to delete a meta sentence.',
      requiresFullRegeneration: false,
      summary: 'Borraré esa frase en ES y EN.',
    };
    const priorImage = await sharp({
      create: {
        background: { r: 20, g: 40, b: 80 },
        channels: 3,
        height: 32,
        width: 48,
      },
    })
      .png()
      .toBuffer()
      .then((buffer) => new Uint8Array(buffer));
    const generation: BlogGenerationPort = {
      async embed() {
        return [];
      },
      async generate() {
        throw new Error('full generate must not run');
      },
      async generateImage() {
        throw new Error('image must not regenerate');
      },
      async interpretRevision() {
        return plan;
      },
      async applyRevisionPatch({ plan: received }) {
        patched = true;
        expect(received.magnitude).toBe('body_patch');
        return {
          ...priorBundle,
          es: {
            ...priorBundle.es,
            body: priorBundle.es.body.replace(
              'Contenido útil en español. ',
              '',
            ),
          },
          en: {
            ...priorBundle.en,
            body: priorBundle.en.body.replace('Useful English content. ', ''),
          },
        };
      },
      async proposeTopic() {
        return 'unused';
      },
    };
    const executor = new BlogExecutor(
      {
        async sync() {
          return { items: [], revision: 'rev' };
        },
      },
      generation,
      {
        async createDraft(input) {
          return {
            baseCommitSha: 'base',
            branch: input.branch,
            files: input.files.map((file) => file.path),
            headCommitSha: 'head-rev',
            pullRequestId: '7',
            pullRequestUrl: 'https://github.test/pull/7',
          };
        },
        async merge() {
          return { mergeCommitSha: 'merge' };
        },
        async revalidate() {},
        async readFileAtRef() {
          return null;
        },
      },
      {
        async waitForPreview(input) {
          return {
            deploymentId: 'd1',
            environment: 'preview',
            readyAt: new Date().toISOString(),
            sha: input.headCommitSha,
            urls: Object.fromEntries(
              input.routes.map((route) => [route, `https://p.test${route}`]),
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
      },
    );
    await executor.applySurgicalRevision({
      priorBundle,
      priorImage,
      plan,
      publicationDate: '2026-08-21',
      manifest: {
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
      } as never,
      requestId: 'req-1',
      requestVersionId: 'ver-2',
    });
    expect(patched).toBe(true);
  });

  it('rejects full_regenerate on the surgical path', async () => {
    const executor = new BlogExecutor(
      { async sync() {
        return { items: [], revision: 'rev' };
      } },
      {
        async embed() {
          return [];
        },
        async generate() {
          return priorBundle;
        },
        async generateImage() {
          return new Uint8Array([1]);
        },
        async interpretRevision() {
          return titlePlan;
        },
        async applyRevisionPatch() {
          return priorBundle;
        },
        async proposeTopic() {
          return 'x';
        },
      },
      {
        async createDraft() {
          throw new Error('unused');
        },
        async merge() {
          return { mergeCommitSha: 'm' };
        },
        async revalidate() {},
        async readFileAtRef() {
          return null;
        },
      },
      {
        async waitForPreview() {
          throw new Error('unused');
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
      },
    );
    await expect(
      executor.applySurgicalRevision({
        priorBundle,
        priorImage: new Uint8Array([1]),
        plan: {
          ...titlePlan,
          magnitude: 'full_regenerate',
          requiresFullRegeneration: true,
          operations: [{ op: 'regenerate_all', instruction: 'rewrite all' }],
        },
        publicationDate: '2026-08-21',
        manifest: {
          content: { editablePaths: [] },
          repository: { branchPattern: 'x' },
        } as never,
        requestId: 'r',
        requestVersionId: 'v',
      }),
    ).rejects.toMatchObject({ category: 'validation_error' });
  });
});
