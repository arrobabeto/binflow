import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { DomainError } from '@binflow/domain';

export const PROJECT_BASE_FACT_IDS = [
  'name',
  'fecha',
  'projectDescription',
  'category',
  'images',
] as const;

export type ProjectBaseFactId = (typeof PROJECT_BASE_FACT_IDS)[number];

export const CONTENT_SCHEMA_FIELD_TYPES = [
  'string',
  'boolean',
  'date',
  'yearMonth',
  'url',
  'enum',
  'stringList',
  'image',
] as const;

export type ContentSchemaFieldType = (typeof CONTENT_SCHEMA_FIELD_TYPES)[number];

const FIELD_ID_PATTERN = /^[a-z][a-zA-Z0-9_]{0,63}$/u;
const MAX_FIELDS = 40;
const MAX_ENUM_VALUES = 32;
const MAX_STRING = 10_000;
const MAX_ASK = 500;
const MAX_STRING_LIST_ITEMS = 50;
const PROJECT_DESCRIPTION_MIN = 40;

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/u;
const YEAR_MONTH = /\b(\d{4}-(0[1-9]|1[0-2]))\b/u;

const MONTH_NAME_TO_NUMBER: Readonly<Record<string, string>> = {
  january: '01',
  febrero: '02',
  february: '02',
  marzo: '03',
  march: '03',
  abril: '04',
  april: '04',
  mayo: '05',
  may: '05',
  junio: '06',
  june: '06',
  julio: '07',
  july: '07',
  agosto: '08',
  august: '08',
  septiembre: '09',
  september: '09',
  octubre: '10',
  october: '10',
  noviembre: '11',
  november: '11',
  diciembre: '12',
  december: '12',
  enero: '01',
};

export const yearMonthSchema = z
  .string()
  .trim()
  .regex(YEAR_MONTH_PATTERN, 'fecha must be YYYY-MM');

export const normalizeYearMonthToIsoDate = (value: string): string => {
  const trimmed = value.trim();
  if (YEAR_MONTH_PATTERN.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(trimmed)) {
    return `${trimmed.slice(0, 7)}-01`;
  }
  throw new DomainError(
    'validation_error',
    'fecha must be YYYY-MM (normalized to YYYY-MM-01).',
    { code: 'project_fecha_invalid' },
  );
};

export const parseYearMonthFromText = (text: string): string | undefined => {
  const yearMonthMatch = YEAR_MONTH.exec(text);
  if (yearMonthMatch?.[1] !== undefined) return yearMonthMatch[1];
  const isoMatch = ISO_DATE.exec(text);
  if (isoMatch?.[1] !== undefined) return isoMatch[1].slice(0, 7);
  const named =
    /\b(enero|january|febrero|february|marzo|march|abril|april|mayo|may|junio|june|julio|july|agosto|august|septiembre|september|octubre|october|noviembre|november|diciembre|december)\s+(\d{4})\b/iu.exec(
      text,
    );
  if (named?.[1] !== undefined && named[2] !== undefined) {
    const month = MONTH_NAME_TO_NUMBER[named[1].toLowerCase()];
    if (month !== undefined) return `${named[2]}-${month}`;
  }
  return undefined;
};

const isPoisonImagePlaceholder = (text: string): boolean => {
  const trimmed = text.trim();
  return trimmed.length === 0 || trimmed === '[image]' || trimmed === '[Image]';
};

/** True when a free-text value is really a URL (must not close string/stringList). */
export const looksLikeUrl = (value: string): boolean =>
  /^https?:\/\/\S+$/iu.test(value.trim()) ||
  /^www\.\S+$/iu.test(value.trim());


const requiredWhenSchema = z
  .object({
    publicationIntent: z.enum(['draft', 'publish']),
  })
  .strict();

export const contentSchemaFieldDefinitionSchema = z
  .object({
    ask: z.string().trim().min(1).max(MAX_ASK).optional(),
    default: z.union([z.string(), z.boolean(), z.number()]).optional(),
    id: z.string().regex(FIELD_ID_PATTERN),
    max: z.number().int().min(1).max(MAX_STRING).optional(),
    maxItems: z.number().int().min(1).max(MAX_STRING_LIST_ITEMS).optional(),
    min: z.number().int().min(0).max(MAX_STRING).optional(),
    minItems: z.number().int().min(0).max(MAX_STRING_LIST_ITEMS).optional(),
    required: z.boolean().default(true),
    requiredWhen: requiredWhenSchema.optional(),
    type: z.enum(CONTENT_SCHEMA_FIELD_TYPES),
    values: z.array(z.string().trim().min(1).max(80)).min(1).max(MAX_ENUM_VALUES).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && (field.values === undefined || field.values.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'enum fields require a non-empty values list.',
        path: ['values'],
      });
    }
    if (field.type !== 'enum' && field.values !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'values is only allowed on enum fields.',
        path: ['values'],
      });
    }
    if (
      (field.type === 'string' || field.type === 'stringList') &&
      field.min !== undefined &&
      field.max !== undefined &&
      field.min > field.max
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'min must be <= max.',
        path: ['min'],
      });
    }
  });

export const contentSchemaDocumentSchema = z
  .object({
    fields: z.array(contentSchemaFieldDefinitionSchema).max(MAX_FIELDS).default([]),
  })
  .strict();

export type ContentSchemaFieldDefinition = z.infer<
  typeof contentSchemaFieldDefinitionSchema
>;
export type ContentSchemaDocument = z.infer<typeof contentSchemaDocumentSchema>;

export const projectBaseFactsSchema = z
  .object({
    category: z.string().trim().min(1).max(80).optional(),
    fecha: yearMonthSchema,
    images: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .optional(),
    name: z.string().trim().min(2).max(120),
    projectDescription: z
      .string()
      .trim()
      .min(PROJECT_DESCRIPTION_MIN)
      .max(10_000),
  })
  .strict();

export type ProjectBaseFacts = z.infer<typeof projectBaseFactsSchema>;

const reservedIds = new Set<string>([
  ...PROJECT_BASE_FACT_IDS,
  'description', // legacy alias — customization cannot redefine it
]);

export const parseContentSchemaYaml = (raw: string): ContentSchemaDocument => {
  let trimmed = raw.trim();
  const fenced = /^```(?:yaml|yml)?\s*\n([\s\S]*?)\n```$/iu.exec(trimmed);
  if (fenced?.[1] !== undefined) trimmed = fenced[1].trim();
  if (trimmed.length === 0) return { fields: [] };
  let parsed: unknown;
  try {
    parsed = parseYaml(trimmed);
  } catch (error) {
    throw new DomainError(
      'validation_error',
      'content_schema YAML is invalid.',
      {
        code: 'content_schema_yaml_invalid',
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  try {
    return contentSchemaDocumentSchema.parse(parsed ?? { fields: [] });
  } catch (error) {
    throw new DomainError(
      'validation_error',
      'content_schema failed allowlist validation.',
      {
        code: 'content_schema_invalid',
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
};

export const assertContentSchemaSafe = (
  document: ContentSchemaDocument,
): void => {
  const seen = new Set<string>();
  for (const field of document.fields) {
    if (reservedIds.has(field.id))
      throw new DomainError(
        'validation_error',
        `content_schema field "${field.id}" collides with a reserved base fact id.`,
        { code: 'content_schema_reserved_id' },
      );
    if (seen.has(field.id))
      throw new DomainError(
        'validation_error',
        `content_schema field "${field.id}" is duplicated.`,
        { code: 'content_schema_duplicate_id' },
      );
    seen.add(field.id);
    if (
      !CONTENT_SCHEMA_FIELD_TYPES.includes(
        field.type as ContentSchemaFieldType,
      )
    )
      throw new DomainError(
        'validation_error',
        `content_schema field type "${String(field.type)}" is not allowlisted.`,
        { code: 'content_schema_type_unknown' },
      );
  }
};

const compileFieldZod = (
  field: ContentSchemaFieldDefinition,
): z.ZodTypeAny => {
  switch (field.type) {
    case 'string': {
      let schema = z.string().trim();
      if (field.min !== undefined) schema = schema.min(field.min);
      else schema = schema.min(1);
      if (field.max !== undefined) schema = schema.max(field.max);
      else schema = schema.max(MAX_STRING);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'date':
      return z.iso.date();
    case 'yearMonth':
      return yearMonthSchema;
    case 'url':
      return z.url();
    case 'image':
      return z
        .string()
        .trim()
        .min(1)
        .max(500)
        .regex(/^[a-z0-9][a-z0-9/_\-.]{1,500}$/u);
    case 'enum': {
      const values = field.values ?? [];
      if (values.length === 0)
        throw new DomainError(
          'validation_error',
          'enum fields require values.',
          { code: 'content_schema_invalid' },
        );
      return z.enum(values as [string, ...string[]]);
    }
    case 'stringList': {
      let item = z.string().trim().min(1).max(80);
      let list = z.array(item);
      if (field.minItems !== undefined) list = list.min(field.minItems);
      else list = list.min(1);
      if (field.maxItems !== undefined) list = list.max(field.maxItems);
      else list = list.max(MAX_STRING_LIST_ITEMS);
      return list;
    }
    default:
      throw new DomainError(
        'validation_error',
        `Unsupported content_schema type.`,
        { code: 'content_schema_type_unknown' },
      );
  }
};

export type ProjectClosedFactsContext = Readonly<{
  publicationIntent?: 'draft' | 'publish';
}>;

export const compileCustomFieldsObjectSchema = (
  document: ContentSchemaDocument,
): z.ZodObject<Record<string, z.ZodTypeAny>> => {
  assertContentSchemaSafe(document);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of document.fields) {
    let fieldSchema = compileFieldZod(field);
    if (!field.required || field.requiredWhen !== undefined)
      fieldSchema = fieldSchema.optional();
    shape[field.id] = fieldSchema;
  }
  return z.object(shape).strict();
};

export const mergeProjectClosedFactsSchema = (
  document: ContentSchemaDocument = { fields: [] },
): z.ZodObject<Record<string, z.ZodTypeAny>> => {
  const custom = compileCustomFieldsObjectSchema(document);
  return projectBaseFactsSchema.merge(custom);
};

export type OpenContractField = Readonly<{
  ask?: string;
  id: string;
  reason: 'missing' | 'invalid' | 'requiredWhen';
  type: ContentSchemaFieldType | ProjectBaseFactId;
}>;

const baseFieldMetas: readonly Readonly<{
  ask: string;
  askDe?: string;
  askEs?: string;
  id: ProjectBaseFactId;
  optional?: boolean;
  type: ContentSchemaFieldType;
}>[] = [
  {
    ask: 'How should we name this project in the portfolio?',
    askDe: 'Wie sollen wir dieses Projekt im Portfolio nennen?',
    askEs: '¿Cómo debemos nombrar este proyecto en el portafolio?',
    id: 'name',
    type: 'string',
  },
  {
    ask: 'What is the project month (YYYY-MM)?',
    askDe: 'In welchem Monat wurde das Projekt geliefert (YYYY-MM)?',
    askEs: '¿En qué mes se entregó el proyecto (YYYY-MM)?',
    id: 'fecha',
    type: 'yearMonth',
  },
  {
    ask: 'In your own words, what is this project about? Include any highlight you want in the case study.',
    askDe:
      'Beschreibe in eigenen Worten, worum es bei dem Projekt geht. Nenne gern einen Highlight für die Case Study.',
    askEs:
      'En tus propias palabras, ¿de qué trata este proyecto? Incluye cualquier highlight que quieras en el caso de estudio.',
    id: 'projectDescription',
    type: 'string',
  },
  {
    ask: 'Optional: which category should this project use?',
    askDe: 'Optional: Welche Kategorie soll dieses Projekt verwenden?',
    askEs: 'Opcional: ¿qué categoría debe usar este proyecto?',
    id: 'category',
    optional: true,
    type: 'string',
  },
  {
    ask: 'Optional: any image paths or asset ids to attach?',
    askDe: 'Optional: Gibt es Bildpfade oder Asset-IDs zum Anhängen?',
    askEs: 'Opcional: ¿hay rutas de imagen o ids de asset para adjuntar?',
    id: 'images',
    optional: true,
    type: 'stringList',
  },
];

const localizedBaseAsk = (
  id: string,
  locale: 'en' | 'es' | 'de',
): string | undefined => {
  const meta = baseFieldMetas.find((field) => field.id === id);
  if (meta === undefined) return undefined;
  if (locale === 'es') return meta.askEs ?? meta.ask;
  if (locale === 'de') return meta.askDe ?? meta.ask;
  return meta.ask;
};

/** Alias legacy `description` → `projectDescription`; normalize fecha day → month. */
export const normalizeClosedFactAliases = (
  facts: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...facts };
  if (
    next.projectDescription === undefined &&
    typeof next.description === 'string' &&
    next.description.trim().length > 0
  ) {
    next.projectDescription = next.description;
  }
  delete next.description;
  if (typeof next.fecha === 'string') {
    const yearMonth = parseYearMonthFromText(next.fecha) ?? next.fecha.trim();
    if (YEAR_MONTH_PATTERN.test(yearMonth)) next.fecha = yearMonth;
    else if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/u.test(yearMonth))
      next.fecha = yearMonth.slice(0, 7);
  }
  return next;
};

export const scoreOpenProjectContracts = (
  facts: Readonly<Record<string, unknown>>,
  document: ContentSchemaDocument = { fields: [] },
  context: ProjectClosedFactsContext = {},
): Readonly<{
  closed: boolean;
  open: readonly OpenContractField[];
  parsed?: Record<string, unknown>;
}> => {
  assertContentSchemaSafe(document);
  const normalized = normalizeClosedFactAliases(facts);
  const open: OpenContractField[] = [];
  const publicationIntent = context.publicationIntent ?? 'draft';

  for (const meta of baseFieldMetas) {
    if (meta.optional === true) {
      if (normalized[meta.id] === undefined) continue;
      const partial = projectBaseFactsSchema.pick({
        [meta.id]: true,
      } as never);
      const result = partial.safeParse({ [meta.id]: normalized[meta.id] });
      if (!result.success)
        open.push({
          ask: meta.ask,
          id: meta.id,
          reason: 'invalid',
          type: meta.type,
        });
      continue;
    }
    if (normalized[meta.id] === undefined) {
      open.push({
        ask: meta.ask,
        id: meta.id,
        reason: 'missing',
        type: meta.type,
      });
      continue;
    }
    const partial = projectBaseFactsSchema.pick({
      [meta.id]: true,
    } as never);
    const result = partial.safeParse({ [meta.id]: normalized[meta.id] });
    if (!result.success)
      open.push({
        ask: meta.ask,
        id: meta.id,
        reason: 'invalid',
        type: meta.type,
      });
  }

  for (const field of document.fields) {
    const value = normalized[field.id];
    const requiredNow =
      field.requiredWhen !== undefined
        ? field.requiredWhen.publicationIntent === publicationIntent
        : field.required;
    if (value === undefined) {
      if (requiredNow)
        open.push({
          ...(field.ask === undefined ? {} : { ask: field.ask }),
          id: field.id,
          reason:
            field.requiredWhen === undefined ? 'missing' : 'requiredWhen',
          type: field.type,
        });
      continue;
    }
    const result = compileFieldZod(field).safeParse(value);
    if (!result.success)
      open.push({
        ...(field.ask === undefined ? {} : { ask: field.ask }),
        id: field.id,
        reason: 'invalid',
        type: field.type,
      });
  }

  if (open.length > 0) return { closed: false, open };

  const merged = mergeProjectClosedFactsSchema(document);
  const parsed = merged.safeParse(normalized);
  if (!parsed.success)
    return {
      closed: false,
      open: [
        {
          ask: 'Please clarify the project details that are still incomplete.',
          id: 'projectDescription',
          reason: 'invalid',
          type: 'string',
        },
      ],
    };
  return { closed: true, open: [], parsed: parsed.data as Record<string, unknown> };
};

export const mergeExtractedProjectFacts = (
  existing: Readonly<Record<string, unknown>>,
  extracted: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = normalizeClosedFactAliases(existing);
  for (const [key, value] of Object.entries(extracted)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    if (key === 'description') {
      if (next.projectDescription === undefined) next.projectDescription = value;
      continue;
    }
    next[key] = value;
  }
  return normalizeClosedFactAliases(next);
};

export const heuristicExtractProjectFacts = (
  message: string,
  openIds: readonly string[],
  document: ContentSchemaDocument = { fields: [] },
): Record<string, unknown> => {
  const text = message.trim();
  const extracted: Record<string, unknown> = {};
  const open = new Set(openIds);
  // Photo-only placeholders must never close string facts.
  if (isPoisonImagePlaceholder(text)) return extracted;

  if (open.has('fecha') && openIds[0] === 'fecha') {
    const yearMonth = parseYearMonthFromText(text);
    if (yearMonth !== undefined) extracted.fecha = yearMonth;
  }
  if (open.has('name') && openIds[0] === 'name') {
    if (text.length >= 2 && text.length <= 120 && !text.includes('\n'))
      extracted.name = text;
    else {
      const firstLine = text.split('\n')[0]?.trim() ?? '';
      const sentence = firstLine.split(/[.!?]/u)[0]?.trim() ?? '';
      const candidate = (sentence.length >= 2 ? sentence : firstLine).slice(
        0,
        120,
      );
      if (candidate.length >= 2) extracted.name = candidate;
    }
  }
  // Only close the free-text project description when it is the field being asked.
  if (
    (openIds[0] === 'projectDescription' || openIds[0] === 'description') &&
    (open.has('projectDescription') || open.has('description')) &&
    text.length >= PROJECT_DESCRIPTION_MIN
  )
    extracted.projectDescription = text;

  for (const field of document.fields) {
    if (!open.has(field.id)) continue;
    // Only close the currently asked field (base or customization).
    if (openIds[0] !== field.id) continue;
    if (field.type === 'boolean') {
      if (/\b(true|yes|sí|si|verdadero)\b/iu.test(text)) extracted[field.id] = true;
      else if (/\b(false|no|falso)\b/iu.test(text)) extracted[field.id] = false;
    } else if (field.type === 'enum' && field.values !== undefined) {
      const found = field.values.find((value) =>
        text.toLowerCase().includes(value.toLowerCase()),
      );
      if (found !== undefined) extracted[field.id] = found;
    } else if (field.type === 'url') {
      const urlMatch = /https?:\/\/\S+/iu.exec(text);
      if (urlMatch?.[0] !== undefined) extracted[field.id] = urlMatch[0].replace(/[),.]+$/u, '');
    } else if (field.type === 'image') {
      // Image facts close only via Telegram photo → artifact key, not free text.
    } else if (field.type === 'date') {
      const match = ISO_DATE.exec(text);
      if (match?.[1] !== undefined) extracted[field.id] = match[1];
    } else if (field.type === 'yearMonth') {
      const yearMonth = parseYearMonthFromText(text);
      if (yearMonth !== undefined) extracted[field.id] = yearMonth;
    } else if (
      field.type === 'string' &&
      text.length >= (field.min ?? 1) &&
      !looksLikeUrl(text)
    ) {
      extracted[field.id] = text.slice(0, field.max ?? MAX_STRING);
    } else if (field.type === 'stringList') {
      const parts = text
        .split(/[,;\n]/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !looksLikeUrl(part))
        .slice(0, field.maxItems ?? MAX_STRING_LIST_ITEMS);
      if (parts.length > 0) extracted[field.id] = parts;
    }
  }
  return extracted;
};

export const buildCollectionQuestion = (
  open: readonly OpenContractField[],
  locale: 'en' | 'es' | 'de' = 'en',
): string => {
  const field = open[0];
  if (field === undefined) {
    return locale === 'es'
      ? '¿Confirmamos el plan del proyecto?'
      : locale === 'de'
        ? 'Können wir den Projektplan bestätigen?'
        : 'Shall we confirm the project plan?';
  }
  const baseAsk = localizedBaseAsk(field.id, locale);
  if (baseAsk !== undefined) return baseAsk;
  if (field.ask !== undefined && field.ask.trim().length > 0) return field.ask;
  if (locale === 'es')
    return `¿Me puedes dar el dato de «${field.id}» para el proyecto?`;
  if (locale === 'de')
    return `Kannst du mir «${field.id}» für das Projekt nennen?`;
  return `Could you share «${field.id}» for this project?`;
};

export const RESERVED_CUSTOMIZATION_SECTIONS = new Set([
  'content_schema',
  'menu_cta_keywords',
]);

export const validateAndParseContentSchemaSection = (
  sectionBody: string | undefined,
): ContentSchemaDocument => {
  if (sectionBody === undefined || sectionBody.trim().length === 0)
    return { fields: [] };
  const document = parseContentSchemaYaml(sectionBody);
  assertContentSchemaSafe(document);
  return document;
};
