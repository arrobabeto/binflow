import { describe, expect, it } from 'vitest';

import {
  assertContentSchemaSafe,
  buildCollectionQuestion,
  heuristicExtractProjectFacts,
  mergeExtractedProjectFacts,
  parseContentSchemaYaml,
  scoreOpenProjectContracts,
  validateAndParseContentSchemaSection,
} from '../src/content-schema.js';
import { getTool, validateCustomizationDocument } from '../src/load.js';

describe('content_schema DSL', () => {
  it('compiles allowlisted fields and scores open base contracts', () => {
    const document = parseContentSchemaYaml(`
fields:
  - id: descriptor
    type: string
    min: 10
    max: 200
    required: true
    ask: "Short summary?"
  - id: confidencial
    type: boolean
    required: true
`);
    expect(document.fields).toHaveLength(2);
    const openBase = scoreOpenProjectContracts({}, document);
    expect(openBase.closed).toBe(false);
    expect(openBase.open.map((field) => field.id)).toEqual(
      expect.arrayContaining([
        'name',
        'fecha',
        'projectDescription',
        'descriptor',
        'confidencial',
      ]),
    );

    const closed = scoreOpenProjectContracts(
      {
        name: 'Booking platform',
        fecha: '2024-06',
        projectDescription:
          'Headless booking for language courses online with Stripe checkout.',
        descriptor: 'Sitio headless para reserva de clases',
        confidencial: true,
      },
      document,
    );
    expect(closed.closed).toBe(true);
    expect(closed.parsed?.name).toBe('Booking platform');
  });

  it('aliases legacy description and normalizes day fecha to year-month', () => {
    const closed = scoreOpenProjectContracts({
      name: 'Booking platform',
      fecha: '2024-06-15',
      description:
        'Headless booking for language courses online with Stripe checkout.',
    });
    expect(closed.closed).toBe(true);
    expect(closed.parsed?.fecha).toBe('2024-06');
    expect(closed.parsed?.projectDescription).toMatch(/Headless booking/);
  });

  it('rejects unknown types, reserved ids, and expressions', () => {
    expect(() =>
      parseContentSchemaYaml(`
fields:
  - id: evil
    type: javascript
`),
    ).toThrow(/allowlist|invalid/i);

    expect(() =>
      assertContentSchemaSafe(
        parseContentSchemaYaml(`
fields:
  - id: name
    type: string
    required: true
`),
      ),
    ).toThrow(/reserved/i);

    expect(() =>
      parseContentSchemaYaml(`
fields:
  - id: bad
    type: string
    required: true
    values: ["nope"]
`),
    ).toThrow();
  });

  it('enforces requiredWhen publicationIntent publish for url', () => {
    const document = parseContentSchemaYaml(`
fields:
  - id: url
    type: url
    required: false
    requiredWhen:
      publicationIntent: publish
`);
    const draft = scoreOpenProjectContracts(
      {
        name: 'Site',
        fecha: '2024-01',
        projectDescription: 'Enough text for the project description field here.',
      },
      document,
      { publicationIntent: 'draft' },
    );
    expect(draft.closed).toBe(true);

    const publish = scoreOpenProjectContracts(
      {
        name: 'Site',
        fecha: '2024-01',
        projectDescription: 'Enough text for the project description field here.',
      },
      document,
      { publicationIntent: 'publish' },
    );
    expect(publish.closed).toBe(false);
    expect(publish.open.some((field) => field.id === 'url')).toBe(true);
  });

  it('does not close string facts from photo placeholders', () => {
    const extracted = heuristicExtractProjectFacts('[image]', [
      'name',
      'projectDescription',
    ]);
    expect(extracted).toEqual({});
  });

  it('does not close projectDescription from answers to other fields', () => {
    const document = parseContentSchemaYaml(`
fields:
  - id: impacto
    type: string
    min: 40
    max: 1000
    required: true
`);
    const whileAskingName = heuristicExtractProjectFacts(
      'Reduced plugin surface and improved Core Web Vitals on mobile devices for caregivers.',
      ['name', 'projectDescription', 'impacto'],
      document,
    );
    expect(whileAskingName.projectDescription).toBeUndefined();
    expect(whileAskingName.impacto).toBeUndefined();

    const asked = heuristicExtractProjectFacts(
      'WordPress to Oxygen migration for a home-care organisation with verified performance gains on mobile.',
      ['projectDescription', 'impacto'],
      document,
    );
    expect(asked.projectDescription).toMatch(/WordPress to Oxygen/);
    expect(asked.impacto).toBeUndefined();

    const impactoOnly = heuristicExtractProjectFacts(
      'Reduced plugin surface and improved Core Web Vitals on mobile devices.',
      ['impacto'],
      document,
    );
    expect(impactoOnly.impacto).toMatch(/Core Web Vitals/);
    expect(impactoOnly.projectDescription).toBeUndefined();
  });

  it('does not poison stack or business fields when answering url', () => {
    const document = parseContentSchemaYaml(`
fields:
  - id: url
    type: url
    required: true
  - id: stack
    type: stringList
    minItems: 1
    maxItems: 30
    required: true
  - id: clienteTipo
    type: string
    min: 3
    max: 120
    required: true
  - id: industria
    type: string
    min: 3
    max: 120
    required: true
`);
    const extracted = heuristicExtractProjectFacts(
      'https://bistrozurlinde.ch',
      ['url', 'stack', 'clienteTipo', 'industria'],
      document,
    );
    expect(extracted.url).toBe('https://bistrozurlinde.ch');
    expect(extracted.stack).toBeUndefined();
    expect(extracted.clienteTipo).toBeUndefined();
    expect(extracted.industria).toBeUndefined();

    const stackAnswer = heuristicExtractProjectFacts(
      'Astro, Orbitype, Tailwind, Headless CMS',
      ['stack', 'clienteTipo'],
      document,
    );
    expect(stackAnswer.stack).toEqual([
      'Astro',
      'Orbitype',
      'Tailwind',
      'Headless CMS',
    ]);
    expect(stackAnswer.clienteTipo).toBeUndefined();
  });

  it('localizes base collection questions', () => {
    expect(
      buildCollectionQuestion(
        [{ id: 'projectDescription', reason: 'missing', type: 'string' }],
        'es',
      ),
    ).toMatch(/propias palabras/i);
  });

  it('extracts year-month and named months', () => {
    expect(
      heuristicExtractProjectFacts('marzo 2026', ['fecha']).fecha,
    ).toBe('2026-03');
    expect(
      heuristicExtractProjectFacts('shipped 2024-11-03', ['fecha']).fecha,
    ).toBe('2024-11');
  });

  it('merges heuristic extracts and builds questions from ask', () => {
    const document = parseContentSchemaYaml(`
fields:
  - id: tipo
    type: enum
    values: ["Sitio web", "Ecommerce"]
    required: true
    ask: "Que tipo es?"
`);
    const extracted = heuristicExtractProjectFacts(
      'Sitio web para academia',
      ['tipo'],
      document,
    );
    const merged = mergeExtractedProjectFacts({}, extracted);
    expect(merged.tipo).toBe('Sitio web');
    const question = buildCollectionQuestion(
      [{ id: 'tipo', reason: 'missing', type: 'enum', ask: 'Que tipo es?' }],
      'es',
    );
    expect(question).toBe('Que tipo es?');
  });

  it('accepts create_project customization with content_schema section', async () => {
    const tool = await getTool('create_project_astro');
    const body = `# Sample

## content_schema

\`\`\`yaml
fields:
  - id: descriptor
    type: string
    min: 10
    max: 80
    required: true
\`\`\`

## generate

Voice: neutral.

## interpret_revision

Surgical first.

## apply_revision

Keep headings.
`;
    const sections = validateCustomizationDocument(
      tool.customizationTemplate,
      body,
    );
    const schema = validateAndParseContentSchemaSection(sections.content_schema);
    expect(schema.fields[0]?.id).toBe('descriptor');
  });

  it('loads webbin customization document against the project template', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const tool = await getTool('create_project_astro');
    const webbin = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../docs/customizations/webbin-create-project-astro.md',
      ),
      'utf8',
    );
    const sections = validateCustomizationDocument(
      tool.customizationTemplate,
      webbin,
    );
    const schema = validateAndParseContentSchemaSection(sections.content_schema);
    expect(schema.fields.map((field) => field.id)).toEqual(
      expect.arrayContaining([
        'clienteTipo',
        'tipo',
        'estado',
        'stack',
        'confidencial',
        'url',
        'heroScreenshot',
      ]),
    );
    const scored = scoreOpenProjectContracts(
      {
        name: 'Reserva idiomas',
        fecha: '2024-05',
        projectDescription:
          'Plataforma headless de reservas para escuela de idiomas con pagos.',
        clienteTipo: 'Escuela de idiomas online',
        industria: 'Edtech',
        didDesign: true,
        didMigration: false,
        tipo: 'Sitio web',
        estado: 'Publicado',
        impacto:
          'Permitió contratar clases sin coordinación manual por cada solicitud.',
        stack: ['Astro', 'Stripe'],
        confidencial: true,
        url: 'https://www.example.com/',
        heroScreenshot: 'inbound/telegram/019fef7e-hero.jpg',
      },
      schema,
    );
    expect(scored.closed).toBe(true);
    const missingUrl = scoreOpenProjectContracts(
      {
        name: 'Reserva idiomas',
        fecha: '2024-05',
        projectDescription:
          'Plataforma headless de reservas para escuela de idiomas con pagos.',
        clienteTipo: 'Escuela de idiomas online',
        industria: 'Edtech',
        didDesign: true,
        didMigration: false,
        tipo: 'Sitio web',
        estado: 'Publicado',
        impacto:
          'Permitió contratar clases sin coordinación manual por cada solicitud.',
        stack: ['Astro', 'Stripe'],
        confidencial: true,
        heroScreenshot: 'inbound/telegram/019fef7e-hero.jpg',
      },
      schema,
    );
    expect(missingUrl.open.some((field) => field.id === 'url')).toBe(true);
  });
});
