import { createHash } from 'node:crypto';

import sharp from 'sharp';

import {
  adaptedGeneratedProjectBundleSchema,
  normalizeProjectFechaToIsoDate,
  projectUrlEvidenceSchema,
  revisionPlanValidatedSchema,
  type CreateProjectAstroInput,
  type GeneratedProjectBundle,
  type ProjectManifest,
  type ProjectUrlEvidence,
  type RevisionOperation,
  type RevisionPlan,
} from '@binflow/contracts';
import { DomainError } from '@binflow/domain';

export type CatalogItem = Readonly<{
  category: string;
  contentHash: string;
  locale: 'es' | 'en';
  slug: string;
  sourceId: string;
  sourceRevision: string;
  title: string;
}>;

export type ProjectFile = Readonly<{
  bytes: Uint8Array;
  mime: 'text/markdown' | 'image/jpeg' | 'image/avif';
  path: string;
  sha256: string;
}>;

export type DraftPublication = Readonly<{
  baseCommitSha: string;
  branch: string;
  files: readonly string[];
  headCommitSha: string;
  pullRequestId: string;
  pullRequestUrl: string;
}>;

export type DeploymentEvidence = Readonly<{
  deploymentId: string;
  environment: 'preview' | 'production';
  readyAt: string;
  sha: string;
  urls: Readonly<Record<string, string>>;
}>;

export type ProjectExecutionInput = Readonly<{
  coverImage?: Uint8Array;
  customizationSection?: string;
  input: CreateProjectAstroInput;
  manifest: ProjectManifest;
  onStage?: (node: string) => Promise<void>;
  requestId: string;
  requestVersionId: string;
}>;

export type ProjectExecutionResult = Readonly<{
  bundle: GeneratedProjectBundle;
  catalog: readonly EmbeddedCatalogItem[];
  catalogRevision: string;
  deployment: DeploymentEvidence;
  files: readonly ProjectFile[];
  intent: string;
  publication: DraftPublication;
  similarity: SimilarityDecision;
}>;

export type EmbeddedCatalogItem = CatalogItem &
  Readonly<{
    embedding: readonly number[];
    normalizedTitle: string;
  }>;

export type SimilarityDecision = Readonly<{
  candidates: readonly Readonly<{
    score: number;
    slug: string;
    title: string;
  }>[];
  level: 'novel' | 'related_expansion' | 'high_overlap';
}>;

export interface ContentCatalogPort {
  sync(input: Readonly<{ manifest: ProjectManifest }>): Promise<
    Readonly<{
      items: readonly CatalogItem[];
      revision: string;
    }>
  >;
}

export interface ProjectGenerationPort {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  extractUrlEvidence(
    input: Readonly<{
      pageText: string;
      sourceUrl: string;
    }>,
  ): Promise<ProjectUrlEvidence>;
  generate(
    input: Readonly<{
      catalog: readonly CatalogItem[];
      customizationSection?: string;
      manifest: ProjectManifest;
      request: CreateProjectAstroInput;
    }>,
  ): Promise<GeneratedProjectBundle>;
  generateImage(prompt: string): Promise<Uint8Array>;
  interpretRevision(
    input: Readonly<{
      bundle: GeneratedProjectBundle;
      feedback: string;
      locale?: string;
    }>,
  ): Promise<RevisionPlan>;
  applyRevisionPatch(
    input: Readonly<{
      bundle: GeneratedProjectBundle;
      customizationSection?: string;
      plan: RevisionPlan;
    }>,
  ): Promise<GeneratedProjectBundle>;
}

export interface RepositoryPublicationPort {
  createDraft(
    input: Readonly<{
      branch: string;
      deletions?: readonly string[];
      files?: readonly ProjectFile[];
      requestId: string;
      slug: string;
    }>,
  ): Promise<DraftPublication>;
  merge(
    input: Readonly<{
      expectedHeadSha: string;
      pullRequestId: string;
    }>,
  ): Promise<Readonly<{ mergeCommitSha: string }>>;
  readFileAtRef(
    input: Readonly<{
      path: string;
      ref: string;
    }>,
  ): Promise<Uint8Array | null>;
  revalidate(
    input: Readonly<{
      expectedFiles: readonly string[];
      expectedHeadSha: string;
      pullRequestId: string;
      requireCommitStatus?: boolean;
    }>,
  ): Promise<void>;
}

export interface DeploymentPort {
  verifyAbsence(
    input: Readonly<{
      mergeCommitSha: string;
      routes: readonly string[];
    }>,
  ): Promise<DeploymentEvidence>;
  waitForProduction(
    input: Readonly<{
      mergeCommitSha: string;
      routes: readonly string[];
    }>,
  ): Promise<DeploymentEvidence>;
  waitForPreview(
    input: Readonly<{
      headCommitSha: string;
      routes: readonly string[];
    }>,
  ): Promise<DeploymentEvidence>;
}

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const slugifySpanish = (value: string): string => {
  const slug = normalizeText(value).replaceAll(/\s+/gu, '-').slice(0, 90);
  if (slug.length < 3 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
    throw new DomainError(
      'validation_error',
      'A safe slug could not be built.',
    );
  return slug;
};

export type PortfolioSectionHeadings = Readonly<{
  challenge: string;
  outcome: string;
  solution: string;
}>;

export const requirePortfolioManifest = (
  manifest: ProjectManifest,
): NonNullable<ProjectManifest['content']['portfolio']> => {
  const portfolio = manifest.content.portfolio;
  if (portfolio === undefined)
    throw new DomainError(
      'policy_denied',
      'Portfolio manifest paths are not configured.',
      { code: 'manifest_portfolio_missing' },
    );
  return portfolio;
};

export const portfolioSectionHeadings = (
  manifest: ProjectManifest,
  locale: 'en' | 'es',
): PortfolioSectionHeadings => {
  const portfolio = requirePortfolioManifest(manifest);
  const headings = portfolio.sectionHeadings[locale];
  if (headings === undefined)
    throw new DomainError(
      'validation_error',
      `Portfolio section headings are missing for locale ${locale}.`,
    );
  return headings;
};

const cosineSimilarity = (
  left: readonly number[],
  right: readonly number[],
): number => {
  if (left.length === 0 || left.length !== right.length)
    throw new DomainError(
      'provider_final',
      'Embedding vectors have inconsistent dimensions.',
    );
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (
      leftValue === undefined ||
      rightValue === undefined ||
      !Number.isFinite(leftValue) ||
      !Number.isFinite(rightValue)
    )
      throw new DomainError(
        'provider_final',
        'Embedding vectors contain invalid values.',
      );
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0)
    throw new DomainError(
      'provider_final',
      'Embedding vectors cannot have zero magnitude.',
    );
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
};

export const decideSemanticSimilarity = (
  catalog: readonly CatalogItem[],
  vectors: readonly (readonly number[])[],
): SimilarityDecision => {
  if (vectors.length !== catalog.length + 1)
    throw new DomainError(
      'provider_final',
      'Embedding response does not match the catalog request.',
    );
  const intent = vectors[0];
  if (intent === undefined)
    throw new DomainError('provider_final', 'Intent embedding is missing.');
  const candidates = catalog
    .map((item, index) => ({ item, vector: vectors[index + 1] ?? [] }))
    .filter(({ item }) => item.locale === 'es')
    .map(({ item, vector }) => ({
      score: Number(
        Math.max(-1, Math.min(1, cosineSimilarity(intent, vector))).toFixed(4),
      ),
      slug: item.slug,
      title: item.title,
    }))
    .filter((item) => item.score >= 0.55)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const top = candidates[0]?.score ?? 0;
  return {
    candidates,
    level:
      top >= 0.9 ? 'high_overlap' : top >= 0.72 ? 'related_expansion' : 'novel',
  };
};

export const portfolioCatalogItems = (
  manifest: ProjectManifest,
  items: readonly CatalogItem[],
): readonly CatalogItem[] => {
  const portfolio = manifest.content.portfolio;
  if (portfolio === undefined) return items;
  const directories = Object.values(portfolio.collections).map(
    (collection) => collection.directory,
  );
  return items.filter((item) =>
    directories.some((directory) => item.sourceId.startsWith(`${directory}/`)),
  );
};

export const portfolioPreviewRoutes = (
  manifest: ProjectManifest,
  slug: string,
): readonly string[] => {
  const portfolio = manifest.content.portfolio;
  if (portfolio === undefined)
    throw new DomainError(
      'policy_denied',
      'Portfolio manifest paths are not configured.',
    );
  const routes: string[] = [];
  for (const collection of Object.values(portfolio.collections)) {
    if (collection === undefined) continue;
    routes.push(`${collection.routePrefix}/${slug}`);
  }
  if (routes.length < 2)
    throw new DomainError(
      'validation_error',
      'Portfolio preview routes are incomplete.',
    );
  return routes;
};

const yamlString = (value: string): string => JSON.stringify(value);

const renderCaseStudy = (
  locale: 'en' | 'es',
  study: GeneratedProjectBundle['es'],
  bundle: GeneratedProjectBundle,
  headings: PortfolioSectionHeadings,
): string => {
  const sections = [
    study.sections.challenge,
    study.sections.solution,
    study.sections.outcome,
  ];
  const orderedHeadings = [
    headings.challenge,
    headings.solution,
    headings.outcome,
  ] as const;
  const lines = [
    '---',
    `descriptor: ${yamlString(study.descriptor)}`,
    `clienteTipo: ${yamlString(study.clienteTipo)}`,
    `industria: ${yamlString(study.industria)}`,
    `rol: ${yamlString(study.rol)}`,
    `tipo: ${yamlString(study.tipo)}`,
    `estado: ${yamlString(study.estado)}`,
    `fecha: ${bundle.fecha}`,
    `resumen: ${yamlString(study.resumen)}`,
    `impacto: ${yamlString(study.impacto)}`,
    'stack:',
    ...study.stack.map((entry) => `  - ${yamlString(entry)}`),
    ...(bundle.url === undefined ? [] : [`url: ${yamlString(bundle.url)}`]),
    ...(bundle.imagen === undefined
      ? []
      : [`imagen: ${yamlString(bundle.imagen)}`]),
    `confidencial: ${String(bundle.confidencial)}`,
    `destacada: ${String(bundle.destacada)}`,
    '---',
    '',
    ...orderedHeadings.flatMap((heading, index) => [
      `## ${heading}`,
      '',
      sections[index]?.trim() ?? '',
      '',
    ]),
  ];
  return lines.join('\n');
};

export const validateProjectBundleAgainstManifest = (
  bundle: GeneratedProjectBundle,
  manifest: ProjectManifest,
): void => {
  const portfolio = requirePortfolioManifest(manifest);
  const parsed = adaptedGeneratedProjectBundleSchema.parse(bundle);
  for (const locale of ['es', 'en'] as const) {
    const study = parsed[locale];
    if (portfolio.enumFields !== undefined) {
      for (const [field, allowed] of Object.entries(portfolio.enumFields)) {
        const value = study[field as keyof typeof study];
        if (typeof value === 'string' && !allowed.includes(value))
          throw new DomainError(
            'validation_error',
            `Field ${field} value is not allowed by manifest.`,
            { code: 'invalid_enum_value' },
          );
      }
    }
    const headings = portfolioSectionHeadings(manifest, locale);
    const rendered = renderCaseStudy(locale, study, parsed, headings);
    for (const heading of Object.values(headings)) {
      if (!rendered.includes(`## ${heading}`))
        throw new DomainError(
          'validation_error',
          `Rendered markdown is missing heading ${heading}.`,
        );
    }
  }
};

const normalizeEnumToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();

export const coercePortfolioEnumValue = (
  value: string,
  allowed: readonly string[],
): string => {
  if (allowed.includes(value)) return value;
  const token = normalizeEnumToken(value);
  const match = allowed.find((entry) => normalizeEnumToken(entry) === token);
  if (match !== undefined) return match;
  throw new DomainError(
    'validation_error',
    `Field value ${value} is not allowed by manifest.`,
    { code: 'invalid_enum_value' },
  );
};

export const normalizeProjectBundleForManifest = (
  bundle: GeneratedProjectBundle,
  manifest: ProjectManifest,
  input?: CreateProjectAstroInput,
): GeneratedProjectBundle => {
  const portfolio = requirePortfolioManifest(manifest);
  const enumFields = portfolio.enumFields;
  if (enumFields === undefined) return bundle;
  let next = structuredClone(bundle) as GeneratedProjectBundle;
  for (const locale of ['es', 'en'] as const) {
    const study = next[locale];
    let tipo = study.tipo;
    let estado = study.estado;
    if (
      input !== undefined &&
      (input.mode === 'brief' || input.mode === 'structured')
    ) {
      if (input.tipo !== undefined) tipo = String(input.tipo);
      if (input.estado !== undefined) estado = String(input.estado);
    }
    if (enumFields.tipo !== undefined)
      tipo = coercePortfolioEnumValue(tipo, enumFields.tipo);
    if (enumFields.estado !== undefined)
      estado = coercePortfolioEnumValue(estado, enumFields.estado);
    next = {
      ...next,
      [locale]: {
        ...study,
        estado,
        tipo,
      },
    };
  }
  return adaptedGeneratedProjectBundleSchema.parse(next);
};

export const assertProjectBundlePublishable = (
  bundle: GeneratedProjectBundle,
  publicationIntent: 'draft' | 'publish' = 'draft',
): void => {
  if (publicationIntent === 'publish' && bundle.url === undefined)
    throw new DomainError(
      'validation_error',
      'Publication intent requires a public url on the bundle.',
      { code: 'publication_url_required' },
    );
};

const sha256 = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const matchesEditablePath = (
  path: string,
  patterns: readonly string[],
): boolean =>
  patterns.some((pattern) => {
    const expression = new RegExp(
      `^${pattern
        .replaceAll(/[.+?^${}()|[\]\\]/gu, '\\$&')
        .replaceAll('**', '.*')
        .replaceAll('*', '[^/]*')}$`,
      'u',
    );
    return expression.test(path);
  });

export const portfolioCoverPublicPath = (
  imageDirectory: string,
  slug: string,
): string => {
  const relative = imageDirectory.replace(/^public\/?/u, '');
  const base = relative.startsWith('/') ? relative : `/${relative}`;
  return `${base.replace(/\/$/u, '')}/${slug}.avif`;
};

export const toProjectCover = async (source: Uint8Array): Promise<Uint8Array> => {
  try {
    const output = await sharp(source)
      .resize(1600, 900, { fit: 'cover', position: 'attention' })
      .avif({ effort: 6, quality: 72 })
      .toBuffer();
    return new Uint8Array(output);
  } catch {
    throw new DomainError(
      'validation_error',
      'Generated cover is not a valid image.',
    );
  }
};

export const assertProjectCoverAvif = async (bytes: Uint8Array): Promise<void> => {
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== 'heif' ||
    metadata.width !== 1600 ||
    metadata.height !== 900
  )
    throw new DomainError(
      'validation_error',
      'Cover must be a real 1600x900 AVIF image.',
    );
};

export const renderProjectArtifacts = async (
  input: Readonly<{
    bundle: GeneratedProjectBundle;
    imageSource?: Uint8Array;
    manifest: ProjectManifest;
  }>,
): Promise<readonly ProjectFile[]> => {
  const portfolio = requirePortfolioManifest(input.manifest);
  const bundle = adaptedGeneratedProjectBundleSchema.parse(input.bundle);
  const esDirectory = portfolio.collections.es?.directory;
  const enDirectory = portfolio.collections.en?.directory;
  if (esDirectory === undefined || enDirectory === undefined)
    throw new DomainError(
      'validation_error',
      'Portfolio bilingual collections are required.',
    );
  const esHeadings = portfolioSectionHeadings(input.manifest, 'es');
  const enHeadings = portfolioSectionHeadings(input.manifest, 'en');
  const esPath = `${esDirectory}/${bundle.slug}.md`;
  const enPath = `${enDirectory}/${bundle.slug}.md`;
  const rawFiles: Array<Omit<ProjectFile, 'sha256'>> = [
    {
      bytes: new TextEncoder().encode(
        renderCaseStudy('es', bundle.es, bundle, esHeadings),
      ),
      mime: 'text/markdown',
      path: esPath,
    },
    {
      bytes: new TextEncoder().encode(
        renderCaseStudy('en', bundle.en, bundle, enHeadings),
      ),
      mime: 'text/markdown',
      path: enPath,
    },
  ];
  if (input.imageSource !== undefined) {
    const imagePath = `${portfolio.imageDirectory}/${bundle.slug}.avif`;
    const bytes = await toProjectCover(input.imageSource);
    await assertProjectCoverAvif(bytes);
    rawFiles.push({
      bytes,
      mime: 'image/avif',
      path: imagePath,
    });
  }
  if (
    rawFiles.length < 2 ||
    rawFiles.length > 3 ||
    rawFiles.some(
      (file) =>
        !matchesEditablePath(file.path, portfolio.editablePaths) &&
        !matchesEditablePath(file.path, input.manifest.content.editablePaths),
    )
  )
    throw new DomainError(
      'policy_denied',
      'Rendered artifacts exceed the active manifest path boundary.',
    );
  return rawFiles.map((file) => ({ ...file, sha256: sha256(file.bytes) }));
};

export const applyDeterministicProjectRevisionOps = (
  bundle: GeneratedProjectBundle,
  plan: RevisionPlan,
): GeneratedProjectBundle => {
  let next = structuredClone(bundle) as GeneratedProjectBundle;
  for (const operation of plan.operations) {
    if (operation.op === 'patch_metadata') {
      const localeArticle = next[operation.locale];
      next = {
        ...next,
        [operation.locale]: {
          ...localeArticle,
          ...operation.fields,
        },
      };
      continue;
    }
    if (operation.op === 'set_title') {
      const localeArticle = next[operation.locale];
      next = {
        ...next,
        [operation.locale]: {
          ...localeArticle,
          descriptor: operation.titulo,
        },
      };
    }
  }
  return next;
};

const closedString = (
  facts: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined => {
  if (facts === undefined) return undefined;
  const value = facts[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const closedBoolean = (
  facts: Readonly<Record<string, unknown>> | undefined,
  key: string,
): boolean | undefined => {
  if (facts === undefined) return undefined;
  const value = facts[key];
  return typeof value === 'boolean' ? value : undefined;
};

const closedStringList = (
  facts: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string[] | undefined => {
  if (facts === undefined) return undefined;
  const value = facts[key];
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
};

export const composeProjectRolFromFacts = (
  facts: Readonly<Record<string, unknown>> | undefined,
  locale: 'es' | 'en' = 'es',
): string | undefined => {
  const explicit = closedString(facts, 'rol');
  if (explicit !== undefined) return explicit;
  if (facts === undefined) return undefined;
  const hasRoleSignal =
    typeof facts.didDesign === 'boolean' ||
    typeof facts.didMigration === 'boolean' ||
    closedString(facts, 'roleExtras') !== undefined;
  if (!hasRoleSignal) return undefined;
  const didDesign = facts.didDesign === true;
  const didMigration = facts.didMigration === true;
  const extras = closedString(facts, 'roleExtras');
  if (locale === 'en') {
    const parts = ['Development'];
    if (didDesign) parts.push('design');
    if (didMigration) parts.push('migration');
    if (extras !== undefined) parts.push(extras);
    return parts.join(', ');
  }
  const parts = ['Desarrollo'];
  if (didDesign) parts.push('diseño');
  if (didMigration) parts.push('migración');
  if (extras !== undefined) parts.push(extras);
  return parts.join(', ');
};

const PLACEHOLDER_COPY =
  /^(not specified|n\/a|tbd|pendiente|sin especificar|confidential client)\.?$/iu;

const looksLikeUrlValue = (value: string): boolean =>
  /^https?:\/\/\S+$/iu.test(value.trim()) || /^www\.\S+$/iu.test(value.trim());

const sanitizeBusinessString = (
  value: string | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  if (looksLikeUrlValue(value)) return undefined;
  return value;
};

const sanitizeStackList = (
  value: string[] | undefined,
): string[] | undefined => {
  if (value === undefined) return undefined;
  const cleaned = value.filter((item) => !looksLikeUrlValue(item));
  return cleaned.length > 0 ? cleaned : undefined;
};

export const mergeClosedFactsIntoProjectBundle = (
  bundle: GeneratedProjectBundle,
  input: CreateProjectAstroInput,
): GeneratedProjectBundle => {
  if (input.mode === 'revision' || input.mode === 'collect')
    throw new DomainError(
      'validation_error',
      'Revision or collect input cannot merge bundle defaults.',
    );
  const closed =
    input.mode === 'brief' && input.closedFacts !== undefined
      ? input.closedFacts
      : undefined;
  const clienteTipo = sanitizeBusinessString(
    closedString(closed, 'clienteTipo'),
  );
  const industria = sanitizeBusinessString(closedString(closed, 'industria'));
  const impacto = closedString(closed, 'impacto');
  const descriptor = closedString(closed, 'descriptor');
  const projectDescription =
    closedString(closed, 'projectDescription') ??
    closedString(closed, 'description');
  const stack = sanitizeStackList(
    input.stack ?? closedStringList(closed, 'stack') ?? undefined,
  );
  const tipo = input.tipo !== undefined ? String(input.tipo) : closedString(closed, 'tipo');
  const estado =
    input.estado !== undefined ? String(input.estado) : closedString(closed, 'estado');
  const destacada =
    input.destacada ?? closedBoolean(closed, 'destacada') ?? bundle.destacada;
  const confidencial =
    input.confidencial ??
    closedBoolean(closed, 'confidencial') ??
    bundle.confidencial;
  const rawFecha =
    input.fecha ?? closedString(closed, 'fecha') ?? bundle.fecha;
  const fecha = normalizeProjectFechaToIsoDate(
    rawFecha ?? new Date().toISOString().slice(0, 10),
  );
  const url = input.url ?? closedString(closed, 'url') ?? bundle.url;

  const applyLocale = (
    study: GeneratedProjectBundle['es'],
    locale: 'es' | 'en',
  ): GeneratedProjectBundle['es'] => {
    const rol = composeProjectRolFromFacts(closed, locale);
    const shared = {
      ...study,
      ...(clienteTipo === undefined ? {} : { clienteTipo }),
      ...(industria === undefined ? {} : { industria }),
      ...(stack === undefined ? {} : { stack }),
      ...(rol === undefined ? {} : { rol }),
      ...(tipo === undefined ? {} : { tipo }),
      ...(estado === undefined ? {} : { estado }),
    };
    if (locale === 'es') {
      return {
        ...shared,
        ...(impacto === undefined ? {} : { impacto }),
        descriptor:
          descriptor ??
          (PLACEHOLDER_COPY.test(study.descriptor.trim())
            ? (closedString(closed, 'name') ?? study.descriptor)
            : study.descriptor),
        resumen:
          projectDescription !== undefined &&
          (PLACEHOLDER_COPY.test(study.resumen.trim()) ||
            study.resumen.trim().length < 40)
            ? projectDescription.slice(0, 500)
            : study.resumen,
      };
    }
    // English: force shared metadata, but keep narrative distinct from Spanish.
    const name = closedString(closed, 'name');
    return {
      ...shared,
      ...(impacto === undefined || !PLACEHOLDER_COPY.test(study.impacto.trim())
        ? {}
        : {
            impacto: impacto.startsWith('EN:')
              ? impacto
              : `Delivered outcome: ${impacto}`,
          }),
      descriptor: PLACEHOLDER_COPY.test(study.descriptor.trim())
        ? (name !== undefined ? `${name} case study` : study.descriptor)
        : study.descriptor,
      resumen:
        projectDescription !== undefined &&
        (PLACEHOLDER_COPY.test(study.resumen.trim()) ||
          study.resumen.trim().length < 40)
          ? `Case study: ${projectDescription}`.slice(0, 500)
          : study.resumen,
    };
  };

  return adaptedGeneratedProjectBundleSchema.parse({
    ...bundle,
    confidencial,
    destacada,
    en: applyLocale(bundle.en, 'en'),
    es: applyLocale(bundle.es, 'es'),
    fecha,
    ...(url === undefined ? {} : { url }),
  });
};

/** @deprecated Use mergeClosedFactsIntoProjectBundle */
const mergeInputDefaults = mergeClosedFactsIntoProjectBundle;

const MAX_PROJECT_URL_BYTES = 512_000;
const PROJECT_URL_FETCH_TIMEOUT_MS = 15_000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (compatible; BinflowPortfolioBot/1.0; +https://binflow.local) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');

const metaContent = (html: string, names: readonly string[]): string[] => {
  const found: string[] = [];
  for (const name of names) {
    const propertyPattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'iu',
    );
    const contentFirstPattern = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`,
      'iu',
    );
    const match =
      propertyPattern.exec(html)?.[1] ?? contentFirstPattern.exec(html)?.[1];
    if (match !== undefined && match.trim().length > 0)
      found.push(decodeHtmlEntities(match.trim()));
  }
  return found;
};

export const extractProjectUrlPageText = (html: string): string => {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
  const metaBits = metaContent(html, [
    'description',
    'og:title',
    'og:description',
    'twitter:title',
    'twitter:description',
  ]);
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const parts = [
    ...(title === undefined ? [] : [decodeHtmlEntities(title.replace(/\s+/gu, ' ').trim())]),
    ...metaBits,
    visible,
  ].filter((part) => part.length > 0);
  return parts.join('\n').slice(0, 24_000);
};

const hasUsableProjectDescription = (
  request: CreateProjectAstroInput,
): boolean => {
  if (request.mode === 'brief') {
    const fromFacts =
      typeof request.closedFacts?.projectDescription === 'string'
        ? request.closedFacts.projectDescription.trim()
        : typeof request.closedFacts?.description === 'string'
          ? request.closedFacts.description.trim()
          : '';
    if (fromFacts.length >= 40) return true;
    if (request.brief.trim().length >= 40) return true;
  }
  return false;
};

export const fetchProjectUrlText = async (
  rawUrl: string,
): Promise<Readonly<{ sourceUrl: string; text: string }>> => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new DomainError(
      'validation_error',
      'Project URL is invalid.',
      { code: 'project_url_fetch_failed' },
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new DomainError(
      'validation_error',
      'Project URL must be http or https.',
      { code: 'project_url_fetch_failed' },
    );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    PROJECT_URL_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,es;q=0.8',
        'user-agent': BROWSER_USER_AGENT,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new DomainError(
        'provider_retryable',
        `Project URL fetch failed with HTTP ${String(response.status)}.`,
        { code: 'project_url_fetch_failed' },
      );
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_PROJECT_URL_BYTES)
      throw new DomainError(
        'provider_retryable',
        'Project URL response was empty or too large.',
        { code: 'project_url_fetch_failed' },
      );
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const text = extractProjectUrlPageText(html);
    if (text.length < 40)
      throw new DomainError(
        'provider_retryable',
        'Project URL did not yield usable page text.',
        { code: 'project_url_fetch_failed' },
      );
    return { sourceUrl: parsed.toString(), text };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const cause = error instanceof Error ? error.message : String(error);
    const timedOut =
      (error instanceof Error && error.name === 'AbortError') ||
      /aborted|timeout/iu.test(cause);
    throw new DomainError(
      'provider_retryable',
      timedOut
        ? 'Project URL fetch timed out.'
        : `Project URL fetch failed: ${cause.slice(0, 200)}`,
      {
        code: 'project_url_fetch_failed',
        cause,
      },
    );
  } finally {
    clearTimeout(timer);
  }
};

export const resolveProjectUrlEvidence = async (
  input: Readonly<{
    generation: ProjectGenerationPort;
    request: CreateProjectAstroInput;
  }>,
): Promise<ProjectUrlEvidence | undefined> => {
  if (input.request.mode === 'brief' && input.request.urlEvidence !== undefined)
    return projectUrlEvidenceSchema.parse(input.request.urlEvidence);
  const url =
    input.request.mode === 'brief' || input.request.mode === 'structured'
      ? (input.request.url ??
        (input.request.mode === 'brief' &&
        typeof input.request.closedFacts?.url === 'string'
          ? String(input.request.closedFacts.url)
          : undefined))
      : undefined;
  if (url === undefined) return undefined;
  try {
    const page = await fetchProjectUrlText(url);
    return await input.generation.extractUrlEvidence({
      pageText: page.text,
      sourceUrl: page.sourceUrl,
    });
  } catch (error) {
    if (hasUsableProjectDescription(input.request)) {
      // Best-effort: generate from closedFacts.projectDescription without URL evidence.
      return undefined;
    }
    const cause =
      error instanceof DomainError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DomainError(
      'validation_error',
      `Could not read the project URL and no projectDescription grounding is available. Add a richer project description (40+ characters) or fix the URL. (${cause})`,
      {
        code: 'project_url_fetch_failed',
        cause,
      },
    );
  }
};

export class ProjectExecutor {
  public constructor(
    private readonly catalog: ContentCatalogPort,
    private readonly generation: ProjectGenerationPort,
    private readonly repository: RepositoryPublicationPort,
    private readonly deployments: DeploymentPort,
  ) {}

  public async execute(
    input: ProjectExecutionInput,
  ): Promise<ProjectExecutionResult> {
    if (input.input.mode === 'revision')
      throw new DomainError(
        'validation_error',
        'Revision requests must resume through the workflow runtime.',
      );
    if (input.input.mode === 'collect')
      throw new DomainError(
        'validation_error',
        'Collection must complete before project execution.',
      );
    await input.onStage?.('catalog_sync');
    const synchronized = await this.catalog.sync({ manifest: input.manifest });
    const catalog = portfolioCatalogItems(input.manifest, synchronized.items);
    const intent =
      input.input.mode === 'brief'
        ? input.input.closedFacts !== undefined &&
          typeof input.input.closedFacts.name === 'string'
          ? String(input.input.closedFacts.name)
          : input.input.brief
        : input.input.bundle.es.descriptor;
    await input.onStage?.('similarity');
    const vectors = await this.generation.embed([
      intent,
      ...catalog.map((item) => item.title),
    ]);
    const similarity = decideSemanticSimilarity(catalog, vectors);
    if (similarity.level === 'high_overlap')
      throw new DomainError(
        'policy_denied',
        'A published project already has high descriptor overlap.',
        { code: 'high_content_overlap' },
      );
    await input.onStage?.('read_project_url');
    let executionInput = input.input;
    if (executionInput.mode === 'brief' || executionInput.mode === 'structured') {
      const urlEvidence = await resolveProjectUrlEvidence({
        generation: this.generation,
        request: executionInput,
      });
      if (urlEvidence !== undefined && executionInput.mode === 'brief')
        executionInput = { ...executionInput, urlEvidence };
    }
    let bundle: GeneratedProjectBundle;
    if (executionInput.mode === 'structured') {
      bundle = mergeInputDefaults(executionInput.bundle, executionInput);
    } else {
      await input.onStage?.('generate');
      bundle = mergeInputDefaults(
        adaptedGeneratedProjectBundleSchema.parse(
          await this.generation.generate({
            catalog,
            manifest: input.manifest,
            ...(input.customizationSection === undefined
              ? {}
              : { customizationSection: input.customizationSection }),
            request: executionInput,
          }),
        ),
        executionInput,
      );
      const slug = slugifySpanish(bundle.es.descriptor);
      bundle = adaptedGeneratedProjectBundleSchema.parse({ ...bundle, slug });
    }
    await input.onStage?.('normalize_project_bundle');
    bundle = normalizeProjectBundleForManifest(
      bundle,
      input.manifest,
      executionInput,
    );
    await input.onStage?.('validate_project_bundle');
    validateProjectBundleAgainstManifest(bundle, input.manifest);
    await input.onStage?.('validate_privacy_and_evidence');
    if (bundle.confidencial) {
      const narrative = [
        bundle.es.descriptor,
        bundle.es.clienteTipo,
        bundle.es.resumen,
        bundle.es.impacto,
        bundle.es.sections.challenge,
        bundle.es.sections.solution,
        bundle.es.sections.outcome,
        bundle.en.descriptor,
        bundle.en.clienteTipo,
        bundle.en.resumen,
        bundle.en.impacto,
        bundle.en.sections.challenge,
        bundle.en.sections.solution,
        bundle.en.sections.outcome,
      ].join('\n');
      if (
        /\b(S\.A\.|S\. de R\.L\.|Inc\.|Ltd\.|GmbH|LLC)\b/u.test(narrative) ||
        /\b[A-Z][a-z]+ (Technologies|Corp|Corporation|Company)\b/u.test(
          narrative,
        )
      )
        throw new DomainError(
          'validation_error',
          'Confidential project narrative appears to name a legal entity.',
          { code: 'privacy_evidence_required' },
        );
    }
    await input.onStage?.('repo_contract_checks');
    assertProjectBundlePublishable(
      bundle,
      executionInput.publicationIntent ?? 'draft',
    );
    const existing = catalog.find(
      (item) => item.locale === 'es' && item.slug === bundle.slug,
    );
    if (existing !== undefined)
      throw new DomainError(
        'policy_denied',
        'Project slug already exists.',
        { code: 'project_slug_collision' },
      );
    const coverFromFacts =
      input.input.mode === 'brief' &&
      input.input.closedFacts !== undefined &&
      typeof input.input.closedFacts.heroScreenshot === 'string'
        ? String(input.input.closedFacts.heroScreenshot)
        : undefined;
    const explicitMode =
      input.input.mode === 'brief' || input.input.mode === 'structured'
        ? input.input.image?.mode
        : undefined;
    const hasProvidedSource =
      input.coverImage !== undefined ||
      ((input.input.mode === 'brief' || input.input.mode === 'structured') &&
        input.input.imageAssetId !== undefined) ||
      coverFromFacts !== undefined;
    const imageMode =
      explicitMode ?? (hasProvidedSource ? 'provided' : 'omit');
    let imageSource: Uint8Array | undefined;
    if (imageMode === 'generate')
      throw new DomainError(
        'validation_error',
        'create_project_astro no longer generates cover images; provide a hero screenshot.',
        { code: 'cover_image_required' },
      );
    if (imageMode === 'provided') {
      imageSource = input.coverImage;
      if (imageSource === undefined)
        throw new DomainError(
          'validation_error',
          'A hero screenshot cover image is required but was not provided.',
          { code: 'cover_image_required' },
        );
      // Always overwrite LLM imagen (often *.jpg) with the AVIF public path.
      bundle = {
        ...bundle,
        imagen: portfolioCoverPublicPath(
          requirePortfolioManifest(input.manifest).imageDirectory,
          bundle.slug,
        ),
      };
    }
    await input.onStage?.('render_artifacts');
    const files = await renderProjectArtifacts({
      bundle,
      manifest: input.manifest,
      ...(imageSource === undefined ? {} : { imageSource }),
    });
    await input.onStage?.('create_draft');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'create-project-astro')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', bundle.slug);
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: bundle.slug,
    });
    const expectedCount = files.length;
    if (
      publication.headCommitSha.length < 7 ||
      publication.files.length !== expectedCount ||
      !files.every((file) => publication.files.includes(file.path))
    )
      throw new DomainError(
        'provider_final',
        'Repository draft evidence does not match the rendered artifacts.',
      );
    const routes = portfolioPreviewRoutes(input.manifest, bundle.slug);
    await input.onStage?.('wait_preview');
    const deployment = await this.deployments.waitForPreview({
      headCommitSha: publication.headCommitSha,
      routes,
    });
    if (
      deployment.environment !== 'preview' ||
      deployment.sha !== publication.headCommitSha ||
      routes.some((route) => deployment.urls[route] === undefined)
    )
      throw new DomainError(
        'policy_denied',
        'Preview is not bound to the exact pull request head.',
      );
    return {
      bundle,
      catalog: catalog.map((item, index) => {
        const embedding = vectors[index + 1];
        if (embedding === undefined)
          throw new DomainError(
            'provider_final',
            'Catalog embedding is missing.',
          );
        return {
          ...item,
          embedding,
          normalizedTitle: normalizeText(item.title),
        };
      }),
      catalogRevision: synchronized.revision,
      deployment,
      files,
      intent,
      publication,
      similarity,
    };
  }

  public async mergeApprovedPreview(
    input: Readonly<{
      deploymentId: string;
      expectedFiles: readonly string[];
      headCommitSha: string;
      previewSha: string;
      pullRequestId: string;
    }>,
  ): Promise<Readonly<{ mergeCommitSha: string }>> {
    if (input.previewSha !== input.headCommitSha)
      throw new DomainError(
        'policy_denied',
        'Preview deployment is not bound to the approved commit.',
      );
    await this.repository.revalidate({
      expectedFiles: input.expectedFiles,
      expectedHeadSha: input.headCommitSha,
      pullRequestId: input.pullRequestId,
    });
    return this.repository.merge({
      expectedHeadSha: input.headCommitSha,
      pullRequestId: input.pullRequestId,
    });
  }

  public async verifyProduction(
    input: Readonly<{
      mergeCommitSha: string;
      routes: readonly string[];
    }>,
  ): Promise<
    Readonly<{
      deployment: DeploymentEvidence;
      mergeCommitSha: string;
    }>
  > {
    const deployment = await this.deployments.waitForProduction(input);
    if (
      deployment.environment !== 'production' ||
      deployment.sha !== input.mergeCommitSha
    )
      throw new DomainError(
        'provider_final',
        'Production deployment is not bound to the merge commit.',
      );
    return { deployment, mergeCommitSha: input.mergeCommitSha };
  }

  public async interpretRevisionPlan(
    input: Readonly<{
      bundle: GeneratedProjectBundle;
      feedback: string;
      locale?: string;
    }>,
  ): Promise<RevisionPlan> {
    return revisionPlanValidatedSchema.parse(
      await this.generation.interpretRevision(input),
    );
  }

  public async regenerateFromPlan(
    input: Readonly<{
      customizationSection?: string;
      manifest: ProjectManifest;
      onStage?: (node: string) => Promise<void>;
      plan: RevisionPlan;
      priorBundle: GeneratedProjectBundle;
      priorImage: Uint8Array;
      request: CreateProjectAstroInput;
      requestId: string;
    }>,
  ): Promise<
    Readonly<{
      bundle: GeneratedProjectBundle;
      deployment: DeploymentEvidence;
      files: readonly ProjectFile[];
      publication: DraftPublication;
    }>
  > {
    await input.onStage?.('generate');
    const generated = adaptedGeneratedProjectBundleSchema.parse(
      await this.generation.generate({
        catalog: [],
        manifest: input.manifest,
        request: input.request,
        ...(input.customizationSection === undefined
          ? {}
          : { customizationSection: input.customizationSection }),
      }),
    );
    const slug = input.plan.preservesSlug
      ? input.priorBundle.slug
      : slugifySpanish(generated.es.descriptor);
    let bundle = mergeInputDefaults(
      adaptedGeneratedProjectBundleSchema.parse({ ...generated, slug }),
      input.request,
    );
    if (bundle.imagen === undefined)
      bundle = {
        ...bundle,
        imagen:
          input.priorBundle.imagen ??
          portfolioCoverPublicPath(
            requirePortfolioManifest(input.manifest).imageDirectory,
            bundle.slug,
          ),
      };
    await input.onStage?.('render_artifacts');
    const files = await renderProjectArtifacts({
      bundle,
      imageSource: input.priorImage,
      manifest: input.manifest,
    });
    await input.onStage?.('create_draft');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'create-project-astro')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', bundle.slug);
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: bundle.slug,
    });
    const routes = portfolioPreviewRoutes(input.manifest, bundle.slug);
    await input.onStage?.('wait_preview');
    const deployment = await this.deployments.waitForPreview({
      headCommitSha: publication.headCommitSha,
      routes,
    });
    return { bundle, deployment, files, publication };
  }

  public async applySurgicalRevision(
    input: Readonly<{
      customizationSection?: string;
      manifest: ProjectManifest;
      onStage?: (node: string) => Promise<void>;
      plan: RevisionPlan;
      priorBundle: GeneratedProjectBundle;
      priorHeadCommitSha?: string;
      priorImage: Uint8Array;
      publicationDate?: string;
      requestId: string;
      requestVersionId: string;
    }>,
  ): Promise<
    Readonly<{
      bundle: GeneratedProjectBundle;
      deployment: DeploymentEvidence;
      files: readonly ProjectFile[];
      image?: Uint8Array;
      publication: DraftPublication;
    }>
  > {
    revisionPlanValidatedSchema.parse(input.plan);
    if (input.plan.magnitude === 'full_regenerate')
      throw new DomainError(
        'validation_error',
        'Surgical revision cannot apply full_regenerate plans.',
      );
    await input.onStage?.('apply_revision');
    const needsAiPatch =
      input.plan.magnitude === 'body_patch' ||
      input.plan.operations.some(
        (operation: RevisionOperation) => operation.op === 'patch_body',
      );
    let bundle: GeneratedProjectBundle;
    if (needsAiPatch) {
      bundle = adaptedGeneratedProjectBundleSchema.parse(
        await this.generation.applyRevisionPatch({
          bundle: input.priorBundle,
          plan: input.plan,
          ...(input.customizationSection === undefined
            ? {}
            : { customizationSection: input.customizationSection }),
        }),
      );
    } else {
      bundle = adaptedGeneratedProjectBundleSchema.parse(
        applyDeterministicProjectRevisionOps(input.priorBundle, input.plan),
      );
    }
    if (input.plan.preservesSlug) {
      bundle = adaptedGeneratedProjectBundleSchema.parse({
        ...bundle,
        slug: input.priorBundle.slug,
      });
    }
    const replaceImage = input.plan.operations.find(
      (operation: RevisionOperation) => operation.op === 'replace_image',
    );
    let image = input.priorImage;
    if (input.plan.magnitude === 'image_only' || replaceImage !== undefined) {
      // Covers are client hero screenshots only (ADR-0036). Reuse prior bytes;
      // a new attachment must be collected before a true cover swap.
      if (image === undefined)
        throw new DomainError(
          'validation_error',
          'Hero screenshot cover is missing for image revision.',
          { code: 'cover_image_required' },
        );
      bundle = adaptedGeneratedProjectBundleSchema.parse({
        ...bundle,
        imagen:
          bundle.imagen ??
          input.priorBundle.imagen ??
          portfolioCoverPublicPath(
            requirePortfolioManifest(input.manifest).imageDirectory,
            bundle.slug,
          ),
      });
    }
    await input.onStage?.('render_artifacts');
    const files = await renderProjectArtifacts({
      bundle,
      ...(image === undefined ? {} : { imageSource: image }),
      manifest: input.manifest,
    });
    await input.onStage?.('create_draft');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'create-project-astro')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', bundle.slug);
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: bundle.slug,
    });
    const routes = portfolioPreviewRoutes(input.manifest, bundle.slug);
    await input.onStage?.('wait_preview');
    const deployment = await this.deployments.waitForPreview({
      headCommitSha: publication.headCommitSha,
      routes,
    });
    return {
      bundle,
      deployment,
      files,
      ...(image === undefined ? {} : { image }),
      publication,
    };
  }
}

export * from './delete-project.js';

export * from './delete-project.js';
