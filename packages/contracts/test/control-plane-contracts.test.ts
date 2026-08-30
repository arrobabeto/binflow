import { describe, expect, it } from 'vitest';

import {
  adminClientMessageInputSchema,
  adminClientMessageQueuedSchema,
  adminOperationReferenceSchema,
  apiErrorResponseSchema,
  clientMessageTargetSchema,
  cursorQuerySchema,
  encodeRequestListCursor,
  decodeRequestListCursor,
  englishBlogBundleCopiesSpanish,
  idempotencyKeySchema,
  projectBudgetPolicySchema,
  requestListQuerySchema,
  requestStateSchema,
  revisionPlanValidatedSchema,
  workflowResumeSignalSchema,
} from '../src/index.js';

describe('control-plane contracts', () => {
  it('accepts surgical revision plans and resume reasons', () => {
    expect(requestStateSchema.parse('AWAITING_REVISION_PLAN_CONFIRMATION')).toBe(
      'AWAITING_REVISION_PLAN_CONFIRMATION',
    );
    expect(
      revisionPlanValidatedSchema.parse({
        localesAffected: ['es'],
        magnitude: 'title_locales',
        operations: [
          {
            locale: 'es',
            op: 'set_title',
            titulo: 'Un título atractivo para el artículo',
          },
        ],
        preservesSlug: true,
        rationale: 'Title polish only.',
        requiresFullRegeneration: false,
        summary: 'Solo actualizaré el título en español.',
      }),
    ).toMatchObject({ magnitude: 'title_locales' });
    expect(() =>
      revisionPlanValidatedSchema.parse({
        localesAffected: ['es'],
        magnitude: 'title_locales',
        operations: [
          {
            locale: 'es',
            op: 'set_title',
            titulo: 'Un título atractivo para el artículo',
          },
        ],
        preservesSlug: true,
        rationale: 'bad combo',
        requiresFullRegeneration: true,
        summary: 'Solo título.',
      }),
    ).toThrow();
    expect(
      workflowResumeSignalSchema.parse({
        reason: 'interpret_revision',
        requestId: 'r1',
        requestVersionId: 'v1',
        tenantId: 't1',
      }).reason,
    ).toBe('interpret_revision');
  });

  it('normalizes OpenAI nullable revision plan fields into domain optionals', async () => {
    const { normalizeRevisionPlanFromModel } = await import('../src/index.js');
    const plan = normalizeRevisionPlanFromModel({
      localesAffected: ['es', 'en'],
      magnitude: 'body_patch',
      operations: [
        {
          instruction: 'Elimina la pregunta de FAQ sobre falsos positivos.',
          locale: 'es',
          op: 'patch_body',
        },
        {
          instruction: 'Remove the FAQ question about false positives.',
          locale: 'en',
          op: 'patch_body',
        },
        {
          fields: {
            descripcion: null,
            faq: null,
            imagenAlt: null,
            keywords: null,
          },
          locale: 'es',
          op: 'patch_metadata',
        },
        {
          locale: 'es',
          op: 'set_title',
          seoTitulo: null,
          titulo: 'Un título atractivo para el artículo',
        },
      ],
      preservesSlug: true,
      rationale: 'Delete FAQ sentence in both locales.',
      requiresFullRegeneration: false,
      summary: 'Borraré esa pregunta en ES y EN.',
    });
    expect(plan.magnitude).toBe('body_patch');
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'patch_body', locale: 'es' }),
        expect.objectContaining({
          op: 'set_title',
          titulo: 'Un título atractivo para el artículo',
        }),
      ]),
    );
    const titleOp = plan.operations.find((operation) => operation.op === 'set_title');
    expect(titleOp).toEqual({
      locale: 'es',
      op: 'set_title',
      titulo: 'Un título atractivo para el artículo',
    });
  });

  it('applies bounded cursor defaults', () => {
    expect(cursorQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(cursorQuerySchema.parse({ limit: '100' })).toEqual({ limit: 100 });
    expect(() => cursorQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => cursorQuerySchema.parse({ extra: true })).toThrow();
  });

  it('accepts only printable, bounded idempotency keys', () => {
    expect(idempotencyKeySchema.parse('request-0123456789')).toBe(
      'request-0123456789',
    );
    expect(() => idempotencyKeySchema.parse('short')).toThrow();
    expect(() =>
      idempotencyKeySchema.parse('request key with spaces'),
    ).toThrow();
    expect(() =>
      idempotencyKeySchema.parse(`request-${'x'.repeat(201)}`),
    ).toThrow();
  });

  it('rejects provider-native or extra error fields', () => {
    const valid = {
      error: {
        category: 'conflict_error',
        code: 'stale_resource',
        correlationId: 'correlation-1',
        message: 'The resource changed. Refresh and retry.',
      },
    };
    expect(apiErrorResponseSchema.parse(valid)).toEqual(valid);
    expect(() =>
      apiErrorResponseSchema.parse({
        ...valid,
        error: { ...valid.error, providerBody: { token: 'secret' } },
      }),
    ).toThrow();
  });

  it('returns relative status URLs for accepted operations', () => {
    const reference = {
      operationId: 'operation-1',
      status: 'pending',
      statusUrl: '/api/v1/operations/operation-1',
    };
    expect(adminOperationReferenceSchema.parse(reference)).toEqual(reference);
    expect(() =>
      adminOperationReferenceSchema.parse({
        ...reference,
        statusUrl: 'https://provider.example/operation-1',
      }),
    ).toThrow();
  });

  it('requires deterministic integer budget ceilings', () => {
    const valid = {
      maxEstimatedCostCentsPerDay: 2000,
      maxEstimatedCostCentsPerRequest: 500,
      maxModelCallsPerRequest: 12,
      maxRequestsPerDay: 10,
      maxTokensPerRequest: 120000,
    };
    expect(projectBudgetPolicySchema.parse(valid)).toEqual(valid);
    expect(() =>
      projectBudgetPolicySchema.parse({
        ...valid,
        maxEstimatedCostCentsPerDay: 100,
      }),
    ).toThrow(/Daily estimated cost/);
    expect(() =>
      projectBudgetPolicySchema.parse({
        ...valid,
        maxRequestsPerDay: 1.5,
      }),
    ).toThrow();
  });

  it('detects English titles copied from Spanish', () => {
    const article = {
      body: '## Heading\n\n' + 'Useful content. '.repeat(40),
      categoria: 'SOP',
      descripcion: 'A practical description of the article for search engines.',
      faq: [
        { pregunta: 'What is this?', respuesta: 'An example.' },
        {
          pregunta: 'Why review?',
          respuesta: 'Because publication is irreversible.',
        },
      ],
      imagenAlt: 'A diagram of a reviewed workflow',
      keywords: ['example', 'review', 'workflow'],
      seoTitulo: 'Example article for review',
      tiempoLectura: 5,
      titulo: 'Example article for review workflows',
    };
    expect(
      englishBlogBundleCopiesSpanish({
        en: article,
        es: {
          ...article,
          body: '## Encabezado\n\n' + 'Contenido útil. '.repeat(40),
          descripcion:
            'Una descripción práctica del artículo para motores de búsqueda.',
          faq: [
            { pregunta: '¿Qué es esto?', respuesta: 'Un ejemplo.' },
            {
              pregunta: '¿Por qué revisar?',
              respuesta: 'Porque la publicación es irreversible.',
            },
          ],
          imagenAlt: 'Un diagrama de un flujo revisado',
          keywords: ['ejemplo', 'revisión', 'flujo'],
          seoTitulo: 'Artículo de ejemplo para revisión',
          titulo: 'Artículo de ejemplo para flujos de revisión',
        },
      }),
    ).toBe(false);
    expect(
      englishBlogBundleCopiesSpanish({
        en: {
          ...article,
          titulo: 'Artículo de ejemplo para flujos de revisión',
        },
        es: {
          ...article,
          body: '## Encabezado\n\n' + 'Contenido útil. '.repeat(40),
          titulo: 'Artículo de ejemplo para flujos de revisión',
        },
      }),
    ).toBe(true);
  });

  it('summarizeRequestStageSummary only exposes allowlisted checkpoint fields', async () => {
    const {
      normalizeProjectBundleFromModel,
      parseRequestExecution,
      projectRequestFailure,
      summarizeRequestStageSummary,
    } = await import('../src/index.js');
    expect(
      summarizeRequestStageSummary({
        apiKey: 'secret-value',
        chainOfThought: 'hidden reasoning',
        errorCategory: 'policy_denied',
        requestState: 'GENERATING',
      }),
    ).toBe('GENERATING · policy_denied');
    expect(
      projectRequestFailure({
        errorCategory: 'policy_denied',
        errorMessage: 'Overlap detected.',
        failedNode: 'generate',
      }),
    ).toMatchObject({
      category: 'policy_denied',
      message: 'Overlap detected.',
      node: 'generate',
    });
    expect(
      projectRequestFailure({
        errorCategory: 'provider_final',
        errorDetail: 'magnitude: Invalid',
        errorMessage: 'Model output failed schema validation.',
        failedNode: 'interpret_revision',
      }),
    ).toMatchObject({
      category: 'provider_final',
      detail: 'magnitude: Invalid',
      message: 'Model output failed schema validation.',
      node: 'interpret_revision',
    });
    expect(parseRequestExecution(null)).toBeNull();
    expect(
      parseRequestExecution({
        errorCategory: 'provider_final',
        errorMessage: 'OpenAI structured output schema is invalid.',
        failedNode: 'generate',
      }),
    ).toEqual({
      approvalStatus: null,
      branch: null,
      categoryKind: null,
      destacada: null,
      files: [],
      headCommitSha: null,
      previewDeploymentId: null,
      previewUrls: {},
      pullRequestUrl: null,
      slug: null,
    });
  });

  it('normalizes nullable project bundle model fields for OpenAI', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const {
      generatedProjectBundleSchema,
      normalizeProjectBundleFromModel,
    } = await import('../src/index.js');
    const fixture = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '../../projects/test/fixtures/typical-confidential.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const normalized = normalizeProjectBundleFromModel({
      ...fixture,
      schemaVersion: 'project_bundle.v1',
      imagen: null,
      url: null,
    });
    expect(normalized).not.toHaveProperty('imagen');
    expect(normalized).not.toHaveProperty('url');
    expect(generatedProjectBundleSchema.parse(normalized)).toBeDefined();
    const withUrl = normalizeProjectBundleFromModel({
      ...fixture,
      schemaVersion: 'project_bundle.v1',
      imagen: null,
      url: 'https://www.example.com/',
    });
    expect(withUrl.url).toBe('https://www.example.com/');
  });

  it('rejects empty and overlong admin client messages', () => {
    expect(() => adminClientMessageInputSchema.parse({ message: '  ' })).toThrow();
    expect(() =>
      adminClientMessageInputSchema.parse({ message: 'x'.repeat(2001) }),
    ).toThrow();
    expect(
      adminClientMessageInputSchema.parse({ message: '  hello  ' }),
    ).toEqual({ message: 'hello' });
    expect(
      clientMessageTargetSchema.parse({
        botUsername: 'bot',
        clientName: 'Webbin',
        paired: true,
        projectKey: 'webbin',
        tenantKey: 'webbin',
      }),
    ).toMatchObject({ paired: true });
    expect(
      adminClientMessageQueuedSchema.parse({
        notificationType: 'admin.direct_message',
        queued: true,
      }),
    ).toEqual({
      notificationType: 'admin.direct_message',
      queued: true,
    });
  });
});
