import { createHash } from 'node:crypto';

import sharp from 'sharp';

import {
  adaptedGeneratedBlogBundleSchema,
  generatedBlogBundleSchema,
  revisionPlanValidatedSchema,
  type CreateBlogDraftInput,
  type GeneratedBlogBundle,
  type ProjectManifest,
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

export type BlogFile = Readonly<{
  bytes: Uint8Array;
  mime: 'text/markdown' | 'image/avif' | 'text/plain' | 'application/pdf';
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

export type BlogPublicationStageIds = Readonly<{
  createGithubDraft: string;
  createOrbitypeDraft?: string;
  mergeGithub: string;
  publishOrbitype?: string;
  waitPreview: string;
}>;

export const defaultBlogPublicationStages: BlogPublicationStageIds =
  Object.freeze({
    createGithubDraft: 'create_draft',
    mergeGithub: 'merge_or_publish',
    waitPreview: 'wait_preview',
  });

export const orbitypeBlogPublicationStages: BlogPublicationStageIds =
  Object.freeze({
    createGithubDraft: 'create_github_draft',
    createOrbitypeDraft: 'create_orbitype_draft',
    mergeGithub: 'merge_github',
    publishOrbitype: 'publish_orbitype',
    waitPreview: 'wait_preview',
  });

export type OrbitypeBlogDraftPort = Readonly<{
  createDraft(
    input: Readonly<{
      body: string;
      category?: string;
      img?: string;
      keywords?: readonly string[];
      lead?: string;
      locale: string;
      requestVersionId: string;
      slug: string;
      title: string;
    }>,
  ): Promise<Readonly<{ draftId: string; locale: string; slug: string }>>;
  publish?(
    input: Readonly<{ draftId: string; requestVersionId: string }>,
  ): Promise<Readonly<{ publishedId: string }>>;
}>;

export type BlogExecutionInput = Readonly<{
  customizationSection?: string;
  editorial?: Readonly<{
    editorialAudience?: string;
    editorialVoice?: string;
    prohibitedClaims?: readonly string[];
    researchPolicy?: string;
  }>;
  input: CreateBlogDraftInput;
  manifest: ProjectManifest;
  onStage?: (node: string) => Promise<void>;
  onTopicRefined?: (topic: string) => Promise<void>;
  orbitype?: OrbitypeBlogDraftPort;
  publicationStages?: BlogPublicationStageIds;
  requestId: string;
  requestVersionId: string;
}>;

export type BlogExecutionResult = Readonly<{
  bundle: GeneratedBlogBundle;
  catalog: readonly EmbeddedCatalogItem[];
  catalogRevision: string;
  deployment: DeploymentEvidence;
  files: readonly BlogFile[];
  intent: string;
  orbitypeDrafts?: readonly Readonly<{
    draftId: string;
    locale: string;
    slug: string;
    titleSlug: string;
  }>[];
  publication: DraftPublication;
  similarity: SimilarityDecision;
}>;

const createOrbitypeDraftsFromBundle = async (
  input: Readonly<{
    bundle: GeneratedBlogBundle;
    orbitype: OrbitypeBlogDraftPort;
    manifest: ProjectManifest;
    requestVersionId: string;
  }>,
): Promise<
  NonNullable<BlogExecutionResult['orbitypeDrafts']>
> => {
  const drafts: Array<
    NonNullable<BlogExecutionResult['orbitypeDrafts']>[number]
  > = [];
  for (const locale of input.manifest.contentLocales) {
    const article = locale === 'en' ? input.bundle.en : input.bundle.es;
    const created = await input.orbitype.createDraft({
      body: article.body,
      category: input.bundle.category,
      img: `/images/blog/${input.bundle.slug}.avif`,
      keywords: article.keywords ?? [],
      lead: article.descripcion,
      locale,
      requestVersionId: input.requestVersionId,
      slug: input.bundle.slug,
      title: article.titulo,
    });
    drafts.push({
      ...created,
      titleSlug: orbitypePostTitleSlug(article.titulo),
    });
  }
  return drafts;
};

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

export interface BlogGenerationPort {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  generate(
    input: Readonly<{
      catalog: readonly CatalogItem[];
      category: CategoryDecision;
      customizationSection?: string;
      editorial?: Readonly<{
        editorialAudience?: string;
        editorialVoice?: string;
        prohibitedClaims?: readonly string[];
        researchPolicy?: string;
      }>;
      /** Frozen manifest locale contract (conversation ≠ content). */
      localeContract?: BlogContentLocaleContract;
      request: CreateBlogDraftInput;
    }>,
  ): Promise<GeneratedBlogBundle>;
  generateImage(prompt: string): Promise<Uint8Array>;
  interpretRevision(
    input: Readonly<{
      bundle: GeneratedBlogBundle;
      feedback: string;
      locale?: string;
    }>,
  ): Promise<RevisionPlan>;
  applyRevisionPatch(
    input: Readonly<{
      bundle: GeneratedBlogBundle;
      customizationSection?: string;
      plan: RevisionPlan;
    }>,
  ): Promise<GeneratedBlogBundle>;
  proposeTopic(
    input: Readonly<{ context: string; locale?: string }>,
  ): Promise<string>;
}

/** Locale fields from the frozen project manifest used at generate time. */
export type BlogContentLocaleContract = Readonly<{
  contentLocales: readonly string[];
  conversationLocale?: string;
  defaultContentLocale: string;
  translationPolicy: string;
}>;

/**
 * System-prompt instructions so generate follows content locales, not the
 * Telegram conversation locale (ADR-0011 / ADR-0046). Hard constraint: never
 * emit publishable prose in a language outside enrolled contentLocales.
 */
export const buildBlogGenerateLocaleInstructions = (
  contract: BlogContentLocaleContract,
): string => {
  const contentLocales = [...contract.contentLocales];
  const monolingual =
    contract.translationPolicy === 'none' && contentLocales.length === 1;
  const primary = contract.defaultContentLocale || contentLocales[0] || 'es';
  const conversation = contract.conversationLocale ?? '(unspecified)';
  const allowed = contentLocales.join(', ');
  const hard =
    `HARD CONSTRAINT: enrolled contentLocales=[${allowed}]. ` +
    `Publishable article prose must be only in those locales. ` +
    `Never write the primary article in conversationLocale=${conversation} unless that locale is also listed in contentLocales. ` +
    `Violating this fails the request.`;
  if (monolingual) {
    const languageName =
      primary === 'de'
        ? 'German'
        : primary === 'en'
          ? 'English'
          : primary === 'es'
            ? 'Spanish'
            : primary;
    return [
      hard,
      `Locale contract: conversationLocale=${conversation}; contentLocales=[${allowed}]; defaultContentLocale=${primary}; translationPolicy=none.`,
      `Write the full publishable article in ${languageName} in the schema "es" fields (titulo, body, seoTitulo, …). Those field names are schema carriers — the prose language must be ${languageName}.`,
      `Fill the schema "en" object with a short English synopsis whose titulo/seoTitulo/headings differ from the primary article (internal schema only; not published).`,
      `Do not write Spanish (or any non-${primary}) body/title for the primary article.`,
    ].join(' ');
  }
  return [
    hard,
    `Locale contract: conversationLocale=${conversation}; contentLocales=[${allowed}]; defaultContentLocale=${primary}; translationPolicy=${contract.translationPolicy}.`,
    `Write the source article in the default content locale in the schema "es" fields and an idiomatic English adaptation in "en" (not a copy of the source titles/headings).`,
    `Conversation locale only affects chat UX — it must not replace required content locales.`,
  ].join(' ');
};

export const isMonolingualContentContract = (
  contract: BlogContentLocaleContract,
): boolean =>
  contract.translationPolicy === 'none' && contract.contentLocales.length === 1;

/** Parse model output: skip English≠Spanish check for monolingual manifests. */
export const parseGeneratedBlogBundleForLocaleContract = (
  value: unknown,
  contract: BlogContentLocaleContract | undefined,
): GeneratedBlogBundle => {
  if (contract !== undefined && isMonolingualContentContract(contract))
    return generatedBlogBundleSchema.parse(value);
  return adaptedGeneratedBlogBundleSchema.parse(value);
};

export const localeContractFromManifest = (
  manifest: ProjectManifest,
): BlogContentLocaleContract => ({
  contentLocales: manifest.contentLocales,
  conversationLocale: manifest.conversationLocale,
  defaultContentLocale: manifest.defaultContentLocale,
  translationPolicy: manifest.translationPolicy,
});

const LANGUAGE_MARKERS = {
  de: [
    'und',
    'für',
    'mit',
    'der',
    'die',
    'das',
    'den',
    'dem',
    'nicht',
    'auch',
    'über',
    'oder',
    'wir',
    'sie',
    'eine',
    'einen',
    'einem',
    'auf',
    'aus',
    'bei',
    'nach',
    'zum',
    'zur',
    'ist',
    'sind',
    'wird',
    'werden',
    'haben',
    'herzlich',
    'willkommen',
    'speisekarte',
    'restaurant',
    'öffnungszeiten',
    'heute',
    'unsere',
    'unser',
  ],
  en: [
    'the',
    'and',
    'with',
    'for',
    'that',
    'this',
    'from',
    'your',
    'about',
    'into',
    'are',
    'is',
    'was',
    'were',
    'have',
    'has',
    'will',
    'can',
    'article',
    'welcome',
  ],
  es: [
    'que',
    'qué',
    'cómo',
    'también',
    'más',
    'está',
    'están',
    'para',
    'con',
    'una',
    'unos',
    'unas',
    'los',
    'las',
    'del',
    'por',
    'como',
    'sobre',
    'gracias',
    'artículo',
    'nuestro',
    'nuestra',
    'hoy',
    'este',
    'esta',
    'estos',
    'estas',
  ],
} as const;

const tokenizeProse = (value: string): readonly string[] =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);

export const scoreProseLanguageMarkers = (
  text: string,
): Readonly<{ de: number; en: number; es: number }> => {
  const tokens = tokenizeProse(text);
  const counts = { de: 0, en: 0, es: 0 };
  for (const token of tokens) {
    if ((LANGUAGE_MARKERS.de as readonly string[]).includes(token))
      counts.de += 1;
    if ((LANGUAGE_MARKERS.en as readonly string[]).includes(token))
      counts.en += 1;
    if ((LANGUAGE_MARKERS.es as readonly string[]).includes(token))
      counts.es += 1;
  }
  // Characteristic letters boost (not exclusive).
  if (/[äöüß]/u.test(text)) counts.de += 3;
  if (/[áéíóúñ¿¡]/iu.test(text)) counts.es += 3;
  return counts;
};

export const detectDominantContentLocale = (
  text: string,
): 'de' | 'en' | 'es' | 'unknown' => {
  const scores = scoreProseLanguageMarkers(text);
  const ranked: Array<readonly ['de' | 'en' | 'es', number]> = [
    ['de', scores.de],
    ['en', scores.en],
    ['es', scores.es],
  ];
  ranked.sort((left, right) => right[1] - left[1]);
  const [best, bestScore] = ranked[0]!;
  const secondScore = ranked[1]?.[1] ?? 0;
  if (bestScore < 2) return 'unknown';
  if (bestScore < secondScore + 2 && secondScore > 0) return 'unknown';
  return best;
};

/**
 * Fail closed when primary published prose is not in an enrolled content locale,
 * or when monolingual projects emit the conversation language instead.
 */
export const assertGeneratedBundleMatchesContentLocales = (
  bundle: GeneratedBlogBundle,
  contract: BlogContentLocaleContract,
): void => {
  const allowed = new Set(contract.contentLocales);
  if (allowed.size === 0)
    throw new DomainError(
      'validation_error',
      'Manifest contentLocales must not be empty.',
      { code: 'content_locales_required' },
    );
  const primary = contract.defaultContentLocale;
  if (!allowed.has(primary))
    throw new DomainError(
      'validation_error',
      'defaultContentLocale must be one of contentLocales.',
      { code: 'default_content_locale_invalid' },
    );

  const primaryText = `${bundle.es.titulo}\n${bundle.es.descripcion}\n${bundle.es.body}`;
  const detected = detectDominantContentLocale(primaryText);
  if (detected !== 'unknown' && !allowed.has(detected))
    throw new DomainError(
      'provider_retryable',
      `Generated primary article language (${detected}) is not in enrolled contentLocales (${[...allowed].join(', ')}).`,
      {
        code: 'content_locale_mismatch',
        detected,
        allowed: [...allowed].join(','),
      },
    );
  if (
    isMonolingualContentContract(contract) &&
    detected !== 'unknown' &&
    detected !== primary
  )
    throw new DomainError(
      'provider_retryable',
      `Monolingual project requires primary article in ${primary}; detected ${detected}.`,
      { code: 'content_locale_mismatch', detected, expected: primary },
    );
  if (
    isMonolingualContentContract(contract) &&
    contract.conversationLocale !== undefined &&
    contract.conversationLocale !== primary &&
    detected === contract.conversationLocale
  )
    throw new DomainError(
      'provider_retryable',
      `Primary article must not use conversation locale ${contract.conversationLocale} when contentLocales are [${[...allowed].join(', ')}].`,
      {
        code: 'content_locale_conversation_bleed',
        detected,
        conversationLocale: contract.conversationLocale,
      },
    );
  if (isMonolingualContentContract(contract) && detected === 'unknown') {
    // Require positive evidence of the enrolled language for monolingual sites.
    const scores = scoreProseLanguageMarkers(primaryText);
    const primaryScore =
      primary === 'de'
        ? scores.de
        : primary === 'en'
          ? scores.en
          : primary === 'es'
            ? scores.es
            : 0;
    if (primaryScore < 3)
      throw new DomainError(
        'provider_retryable',
        `Primary article lacks clear ${primary} language markers for enrolled contentLocales.`,
        {
          code: 'content_locale_unverified',
          expected: primary,
          scores: JSON.stringify(scores),
        },
      );
  }
  if (
    !isMonolingualContentContract(contract) &&
    allowed.has('en') &&
    allowed.has('es')
  ) {
    const englishDetected = detectDominantContentLocale(
      `${bundle.en.titulo}\n${bundle.en.descripcion}\n${bundle.en.body}`,
    );
    if (englishDetected === 'es')
      throw new DomainError(
        'provider_retryable',
        'English article fields appear to be Spanish; enrolled content requires a distinct English adaptation.',
        { code: 'content_locale_mismatch', detected: 'es', expected: 'en' },
      );
  }
};


export interface RepositoryPublicationPort {
  createDraft(
    input: Readonly<{
      branch: string;
      deletions?: readonly string[];
      files?: readonly BlogFile[];
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
      /** When false, skip combined commit status (deletion PRs; no preview gate). Default true. */
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
  verifyDeletionRedirects(
    input: Readonly<{
      mergeCommitSha: string;
      redirectTargets: Readonly<Record<string, string>>;
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

export type CategoryDecision =
  | Readonly<{ category: string; kind: 'existing' }>
  | Readonly<{
      category: string;
      confidence: number;
      kind: 'likely_typo';
      supplied: string;
    }>
  | Readonly<{ category: string; kind: 'new' }>;

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const slugifySpanish = (value: string): string => {
  const slug = normalizeText(value).replaceAll(/\s+/gu, '-').slice(0, 90);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug))
    throw new DomainError(
      'validation_error',
      'A safe slug could not be built.',
    );
  return slug;
};

const levenshtein = (left: string, right: string): number => {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
};

export const decideCategory = (
  supplied: string | undefined,
  catalog: readonly CatalogItem[],
): CategoryDecision => {
  const categories = [...new Set(catalog.map((item) => item.category))];
  const trimmed = supplied?.trim();
  const requested =
    trimmed === undefined || trimmed.length === 0
      ? (categories[0] ?? 'Web App')
      : trimmed;
  const exact = categories.find(
    (category) => normalizeText(category) === normalizeText(requested),
  );
  if (exact !== undefined) return { category: exact, kind: 'existing' };
  const ranked = categories
    .map((category) => {
      const left = normalizeText(requested);
      const right = normalizeText(category);
      const distance = levenshtein(left, right);
      return {
        category,
        confidence: 1 - distance / Math.max(left.length, right.length, 1),
      };
    })
    .sort((left, right) => right.confidence - left.confidence);
  const likely = ranked[0];
  if (likely !== undefined && likely.confidence >= 0.78)
    return {
      category: likely.category,
      confidence: likely.confidence,
      kind: 'likely_typo',
      supplied: requested,
    };
  return { category: requested, kind: 'new' };
};

const tokens = (value: string): Set<string> =>
  new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length > 2),
  );

const jaccard = (left: Set<string>, right: Set<string>): number => {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / union.size;
};

/** @deprecated Jaccard helper retained for unit tests; production uses decideSemanticSimilarity. */
export const decideSimilarity = (
  input: CreateBlogDraftInput,
  catalog: readonly CatalogItem[],
): SimilarityDecision => {
  const intent = input.mode === 'brief' ? input.topic : input.title;
  const candidates = catalog
    .filter((item) => item.locale === 'es')
    .map((item) => ({
      score: Number(jaccard(tokens(intent), tokens(item.title)).toFixed(4)),
      slug: item.slug,
      title: item.title,
    }))
    .filter((item) => item.score >= 0.2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const top = candidates[0]?.score ?? 0;
  return {
    candidates,
    level:
      top >= 0.72
        ? 'high_overlap'
        : top >= 0.35
          ? 'related_expansion'
          : 'novel',
  };
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

const yamlString = (value: string): string => JSON.stringify(value);
const renderArticle = (
  article: GeneratedBlogBundle['es'],
  slug: string,
  publicationDate: string,
): string => {
  const lines = [
    '---',
    `titulo: ${yamlString(article.titulo)}`,
    `seoTitulo: ${yamlString(article.seoTitulo)}`,
    `descripcion: ${yamlString(article.descripcion)}`,
    `categoria: ${yamlString(article.categoria)}`,
    `fechaPublicacion: ${publicationDate}`,
    `fechaActualizacion: ${publicationDate}`,
    `tiempoLectura: ${String(article.tiempoLectura)}`,
    `imagen: ${yamlString(`/images/articles/${slug}.avif`)}`,
    `imagenAlt: ${yamlString(article.imagenAlt)}`,
    'keywords:',
    ...article.keywords.map((keyword) => `  - ${yamlString(keyword)}`),
    'faq:',
    ...article.faq.flatMap((entry) => [
      `  - pregunta: ${yamlString(entry.pregunta)}`,
      `    respuesta: ${yamlString(entry.respuesta)}`,
    ]),
    '---',
    '',
    article.body.trim(),
    '',
  ];
  return lines.join('\n');
};

const sha256 = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const matchesEditablePath = (
  path: string,
  patterns: readonly string[],
): boolean =>
  patterns.some((pattern) => {
    // Expand **/ before single-star so `**` → `.*` is not corrupted by `*` → `[^/]*`,
    // and so `dir/**/*.md` matches files directly under `dir/` as well as nested.
    const expression = new RegExp(
      `^${pattern
        .replaceAll(/[.+?^${}()|[\]\\]/gu, '\\$&')
        .replaceAll('**/', '\0GLOBSTAR_SLASH\0')
        .replaceAll('**', '\0GLOBSTAR\0')
        .replaceAll('*', '[^/]*')
        .replaceAll('\0GLOBSTAR_SLASH\0', '(?:.*/)?')
        .replaceAll('\0GLOBSTAR\0', '.*')}$`,
      'u',
    );
    return expression.test(path);
  });

export const toAvif = async (source: Uint8Array): Promise<Uint8Array> => {
  try {
    const output = await sharp(source)
      .resize(1536, 1024, { fit: 'cover', position: 'attention' })
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

export const assertAvif = async (bytes: Uint8Array): Promise<void> => {
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== 'heif' ||
    metadata.width !== 1536 ||
    metadata.height !== 1024
  )
    throw new DomainError(
      'validation_error',
      'Cover must be a real 1536x1024 AVIF image.',
    );
};

/** Match Bistro `postTitleSlug` for `/posts/{id}/{slug}` preview URLs. */
export const orbitypePostTitleSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');

export const blogPreviewRoutes = (
  manifest: ProjectManifest,
  slug: string,
  options?: Readonly<{
    orbitypeDrafts?: readonly Readonly<{
      draftId: string;
      titleSlug: string;
    }>[];
  }>,
): readonly string[] => {
  const useOrbitypeRoutes =
    manifest.profile === 'astro_orbitype' ||
    manifest.content.source === 'orbitype';
  if (!useOrbitypeRoutes) {
    return [`/es/articulos/${slug}`, `/articulos/${slug}`];
  }
  const drafts = options?.orbitypeDrafts;
  if (drafts === undefined || drafts.length === 0)
    throw new DomainError(
      'validation_error',
      'Orbitype preview routes require CMS draft ids.',
      { code: 'orbitype_preview_routes_missing' },
    );
  return drafts.map((draft) =>
    draft.titleSlug.length > 0
      ? `/posts/${draft.draftId}/${draft.titleSlug}`
      : `/posts/${draft.draftId}`,
  );
};

export const renderWebbinArtifacts = async (
  input: Readonly<{
    bundle: GeneratedBlogBundle;
    imageSource: Uint8Array;
    manifest: ProjectManifest;
    publicationDate: string;
  }>,
): Promise<readonly BlogFile[]> => {
  const bundle = adaptedGeneratedBlogBundleSchema.parse(input.bundle);
  const image = await toAvif(input.imageSource);
  await assertAvif(image);
  const useManifestPaths =
    input.manifest.profile === 'astro_orbitype' ||
    input.manifest.content.source === 'orbitype';
  const localeArticles: ReadonlyArray<
    Readonly<{ article: GeneratedBlogBundle['es']; locale: 'en' | 'es' | 'de' }>
  > = useManifestPaths
    ? input.manifest.contentLocales.map((locale) => ({
        article: locale === 'en' ? bundle.en : bundle.es,
        locale,
      }))
    : [
        { article: bundle.es, locale: 'es' as const },
        { article: bundle.en, locale: 'en' as const },
      ];
  const rawFiles: Array<{
    bytes: Uint8Array;
    mime: 'text/markdown' | 'image/avif';
    path: string;
  }> = [];
  for (const entry of localeArticles) {
    const collection = input.manifest.content.collections?.[entry.locale];
    const directory =
      collection?.directory ??
      (entry.locale === 'es'
        ? 'src/content/articulos-es'
        : 'src/content/articulos');
    rawFiles.push({
      bytes: new TextEncoder().encode(
        renderArticle(entry.article, bundle.slug, input.publicationDate),
      ),
      mime: 'text/markdown',
      path: `${directory}/${bundle.slug}.md`,
    });
  }
  const imageDirectory =
    input.manifest.content.imageDirectory ??
    (useManifestPaths ? undefined : 'public/images/articles');
  if (imageDirectory === undefined || imageDirectory.length === 0)
    throw new DomainError(
      'validation_error',
      'Manifest content.imageDirectory is required for this profile.',
      { code: 'manifest_image_directory_missing' },
    );
  const imagePath = `${imageDirectory}/${bundle.slug}.avif`;
  rawFiles.push({ bytes: image, mime: 'image/avif', path: imagePath });
  const expectedFileCount = useManifestPaths
    ? Math.max(2, input.manifest.contentLocales.length + 1)
    : 3;
  if (
    rawFiles.length !== expectedFileCount ||
    rawFiles.some(
      (file) =>
        !matchesEditablePath(file.path, input.manifest.content.editablePaths),
    )
  )
    throw new DomainError(
      'policy_denied',
      'Rendered artifacts exceed the active manifest path boundary.',
    );
  return rawFiles.map((file) => ({ ...file, sha256: sha256(file.bytes) }));
};

export const applyDeterministicRevisionOps = (
  bundle: GeneratedBlogBundle,
  plan: RevisionPlan,
): GeneratedBlogBundle => {
  let next = structuredClone(bundle) as GeneratedBlogBundle;
  for (const operation of plan.operations) {
    if (operation.op === 'set_title') {
      const localeArticle = next[operation.locale];
      next = {
        ...next,
        [operation.locale]: {
          ...localeArticle,
          titulo: operation.titulo,
          ...(operation.seoTitulo === undefined
            ? {}
            : { seoTitulo: operation.seoTitulo }),
        },
      };
      continue;
    }
    if (operation.op === 'patch_metadata') {
      const localeArticle = next[operation.locale];
      next = {
        ...next,
        [operation.locale]: {
          ...localeArticle,
          ...operation.fields,
        },
      };
    }
  }
  return next;
};

export type SurgicalRevisionInput = Readonly<{
  priorBundle: GeneratedBlogBundle;
  priorImage: Uint8Array;
  priorHeadCommitSha?: string;
  plan: RevisionPlan;
  customizationSection?: string;
  publicationDate: string;
  manifest: ProjectManifest;
  requestId: string;
  requestVersionId: string;
  onStage?: (node: string) => Promise<void>;
  orbitype?: OrbitypeBlogDraftPort;
  publicationStages?: BlogPublicationStageIds;
}>;

export class BlogExecutor {
  public constructor(
    private readonly catalog: ContentCatalogPort,
    private readonly generation: BlogGenerationPort,
    private readonly repository: RepositoryPublicationPort,
    private readonly deployments: DeploymentPort,
  ) {}

  public async execute(
    input: BlogExecutionInput,
  ): Promise<BlogExecutionResult> {
    await input.onStage?.('catalog_sync');
    const synchronized = await this.catalog.sync({ manifest: input.manifest });
    let requestInput = input.input;
    if (
      requestInput.mode === 'brief' &&
      requestInput.context !== undefined &&
      requestInput.context.trim().length > 0
    ) {
      await input.onStage?.('interpret_brief');
      const topic = await this.generation.proposeTopic({
        context: requestInput.context,
        ...(requestInput.sourceLocale === undefined
          ? {}
          : { locale: requestInput.sourceLocale }),
      });
      requestInput = { ...requestInput, topic };
      await input.onTopicRefined?.(topic);
    }
    const intent =
      requestInput.mode === 'brief' ? requestInput.topic : requestInput.title;
    await input.onStage?.('similarity');
    const vectors = await this.generation.embed([
      intent,
      ...synchronized.items.map((item) => item.title),
    ]);
    const similarity = decideSemanticSimilarity(synchronized.items, vectors);
    if (similarity.level === 'high_overlap')
      throw new DomainError(
        'policy_denied',
        'A published article already has high topic overlap.',
        { code: 'high_content_overlap' },
      );
    await input.onStage?.('category_decision');
    const category = decideCategory(requestInput.category, synchronized.items);
    await input.onStage?.('generate');
    const localeContract = localeContractFromManifest(input.manifest);
    const generated = parseGeneratedBlogBundleForLocaleContract(
      await this.generation.generate({
        catalog: synchronized.items,
        category,
        ...(input.customizationSection === undefined
          ? {}
          : { customizationSection: input.customizationSection }),
        ...(input.editorial === undefined ? {} : { editorial: input.editorial }),
        localeContract,
        request: requestInput,
      }),
      localeContract,
    );
    assertGeneratedBundleMatchesContentLocales(generated, localeContract);
    if (
      generated.category !== category.category ||
      generated.categoryKind !== category.kind ||
      generated.es.categoria !== category.category ||
      generated.en.categoria !== category.category
    )
      throw new DomainError(
        'policy_denied',
        'Generated category does not match the deterministic decision.',
      );
    const slug = slugifySpanish(generated.es.titulo);
    const bundle = parseGeneratedBlogBundleForLocaleContract(
      {
        ...generated,
        slug,
      },
      localeContract,
    );
    assertGeneratedBundleMatchesContentLocales(bundle, localeContract);
    await input.onStage?.('prepare_image');
    const image = await this.generation.generateImage(bundle.imagePrompt);
    const publicationDate =
      requestInput.publicationDate ?? new Date().toISOString().slice(0, 10);
    await input.onStage?.('render_artifacts');
    const files = await renderWebbinArtifacts({
      bundle,
      imageSource: image,
      manifest: input.manifest,
      publicationDate,
    });
    await input.onStage?.(
      (input.publicationStages ?? defaultBlogPublicationStages)
        .createGithubDraft,
    );
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'create-blog')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', bundle.slug);
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: bundle.slug,
    });
    if (
      publication.headCommitSha.length < 7 ||
      publication.files.length < 1 ||
      !files.every((file) => publication.files.includes(file.path))
    )
      throw new DomainError(
        'provider_final',
        'Repository draft evidence does not match the rendered artifacts.',
        { code: 'github_draft_evidence_mismatch' },
      );
    const stages = input.publicationStages ?? defaultBlogPublicationStages;
    let orbitypeDrafts: BlogExecutionResult['orbitypeDrafts'];
    if (
      stages.createOrbitypeDraft !== undefined &&
      input.orbitype !== undefined
    ) {
      await input.onStage?.(stages.createOrbitypeDraft);
      orbitypeDrafts = await createOrbitypeDraftsFromBundle({
        bundle,
        manifest: input.manifest,
        orbitype: input.orbitype,
        requestVersionId: input.requestVersionId,
      });
    }
    const routes = blogPreviewRoutes(input.manifest, bundle.slug, {
      ...(orbitypeDrafts === undefined
        ? {}
        : {
            orbitypeDrafts: orbitypeDrafts.map((draft) => ({
              draftId: draft.draftId,
              titleSlug: draft.titleSlug,
            })),
          }),
    });
    await input.onStage?.(stages.waitPreview);
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
        { code: 'preview_binding_mismatch' },
      );
    return {
      bundle,
      catalog: synchronized.items.map((item, index) => {
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
      ...(orbitypeDrafts === undefined ? {} : { orbitypeDrafts }),
    };
  }

  public async applySurgicalRevision(
    input: SurgicalRevisionInput,
  ): Promise<
    Readonly<{
      bundle: GeneratedBlogBundle;
      deployment: DeploymentEvidence;
      files: readonly BlogFile[];
      image: Uint8Array;
      orbitypeDrafts?: BlogExecutionResult['orbitypeDrafts'];
      publication: DraftPublication;
    }>
  > {
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
    let bundle: GeneratedBlogBundle;
    if (needsAiPatch) {
      bundle = adaptedGeneratedBlogBundleSchema.parse(
        await this.generation.applyRevisionPatch({
          bundle: input.priorBundle,
          plan: input.plan,
          ...(input.customizationSection === undefined
            ? {}
            : { customizationSection: input.customizationSection }),
        }),
      );
    } else {
      bundle = adaptedGeneratedBlogBundleSchema.parse(
        applyDeterministicRevisionOps(input.priorBundle, input.plan),
      );
    }
    if (input.plan.preservesSlug) {
      bundle = adaptedGeneratedBlogBundleSchema.parse({
        ...bundle,
        slug: input.priorBundle.slug,
        category: input.priorBundle.category,
        categoryKind: input.priorBundle.categoryKind,
        es: { ...bundle.es, categoria: input.priorBundle.es.categoria },
        en: { ...bundle.en, categoria: input.priorBundle.en.categoria },
      });
    }
    const replaceImage = input.plan.operations.find(
      (operation: RevisionOperation) => operation.op === 'replace_image',
    );
    let image = input.priorImage;
    if (input.plan.magnitude === 'image_only' || replaceImage !== undefined) {
      await input.onStage?.('prepare_image');
      const prompt =
        replaceImage === undefined
          ? bundle.imagePrompt
          : `${bundle.imagePrompt}\nRevision: ${replaceImage.instruction}`;
      image = await this.generation.generateImage(prompt);
      bundle = adaptedGeneratedBlogBundleSchema.parse({
        ...bundle,
        imagePrompt: prompt,
      });
    }
    await input.onStage?.('render_artifacts');
    const files = await renderWebbinArtifacts({
      bundle,
      imageSource: image,
      manifest: input.manifest,
      publicationDate: input.publicationDate,
    });
    const stages = input.publicationStages ?? defaultBlogPublicationStages;
    await input.onStage?.(stages.createGithubDraft);
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'create-blog')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', bundle.slug);
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: bundle.slug,
    });
    if (
      input.priorHeadCommitSha !== undefined &&
      publication.headCommitSha === input.priorHeadCommitSha
    )
      throw new DomainError(
        'validation_error',
        'Revision did not change draft files; refusing to bind the previous preview head.',
      );
    let orbitypeDrafts: BlogExecutionResult['orbitypeDrafts'];
    if (
      stages.createOrbitypeDraft !== undefined &&
      input.orbitype !== undefined
    ) {
      await input.onStage?.(stages.createOrbitypeDraft);
      orbitypeDrafts = await createOrbitypeDraftsFromBundle({
        bundle,
        manifest: input.manifest,
        orbitype: input.orbitype,
        requestVersionId: input.requestVersionId,
      });
    }
    const routes = blogPreviewRoutes(input.manifest, bundle.slug, {
      ...(orbitypeDrafts === undefined
        ? {}
        : {
            orbitypeDrafts: orbitypeDrafts.map((draft) => ({
              draftId: draft.draftId,
              titleSlug: draft.titleSlug,
            })),
          }),
    });
    await input.onStage?.(stages.waitPreview);
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
      deployment,
      files,
      image,
      publication,
      ...(orbitypeDrafts === undefined ? {} : { orbitypeDrafts }),
    };
  }

  public async interpretRevisionPlan(
    input: Readonly<{
      bundle: GeneratedBlogBundle;
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
      priorBundle: GeneratedBlogBundle;
      plan: RevisionPlan;
      request: CreateBlogDraftInput;
      customizationSection?: string;
      editorial?: BlogExecutionInput['editorial'];
      publicationDate: string;
      manifest: ProjectManifest;
      requestId: string;
      requestVersionId: string;
      onStage?: (node: string) => Promise<void>;
      orbitype?: OrbitypeBlogDraftPort;
      publicationStages?: BlogPublicationStageIds;
    }>,
  ): Promise<
    Readonly<{
      bundle: GeneratedBlogBundle;
      deployment: DeploymentEvidence;
      files: readonly BlogFile[];
      orbitypeDrafts?: BlogExecutionResult['orbitypeDrafts'];
      publication: DraftPublication;
    }>
  > {
    await input.onStage?.('generate');
    const category: CategoryDecision =
      input.priorBundle.categoryKind === 'likely_typo'
        ? {
            category: input.priorBundle.category,
            confidence: 1,
            kind: 'likely_typo',
            supplied: input.priorBundle.category,
          }
        : {
            category: input.priorBundle.category,
            kind: input.priorBundle.categoryKind,
          };
    const localeContract = localeContractFromManifest(input.manifest);
    const generated = parseGeneratedBlogBundleForLocaleContract(
      await this.generation.generate({
        catalog: [],
        category,
        request: input.request,
        ...(input.customizationSection === undefined
          ? {}
          : { customizationSection: input.customizationSection }),
        ...(input.editorial === undefined ? {} : { editorial: input.editorial }),
        localeContract,
      }),
      localeContract,
    );
    assertGeneratedBundleMatchesContentLocales(generated, localeContract);
    const slug = input.plan.preservesSlug
      ? input.priorBundle.slug
      : slugifySpanish(generated.es.titulo);
    let bundle = parseGeneratedBlogBundleForLocaleContract(
      {
        ...generated,
        slug,
        category: input.priorBundle.category,
        categoryKind: input.priorBundle.categoryKind,
        es: { ...generated.es, categoria: input.priorBundle.category },
        en: { ...generated.en, categoria: input.priorBundle.category },
      },
      localeContract,
    );
    assertGeneratedBundleMatchesContentLocales(bundle, localeContract);
    await input.onStage?.('prepare_image');
    const image = await this.generation.generateImage(bundle.imagePrompt);
    await input.onStage?.('render_artifacts');
    const files = await renderWebbinArtifacts({
      bundle,
      imageSource: image,
      manifest: input.manifest,
      publicationDate: input.publicationDate,
    });
    const stages = input.publicationStages ?? defaultBlogPublicationStages;
    await input.onStage?.(stages.createGithubDraft);
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'create-blog')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', bundle.slug);
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: bundle.slug,
    });
    let orbitypeDrafts: BlogExecutionResult['orbitypeDrafts'];
    if (
      stages.createOrbitypeDraft !== undefined &&
      input.orbitype !== undefined
    ) {
      await input.onStage?.(stages.createOrbitypeDraft);
      orbitypeDrafts = await createOrbitypeDraftsFromBundle({
        bundle,
        manifest: input.manifest,
        orbitype: input.orbitype,
        requestVersionId: input.requestVersionId,
      });
    }
    const routes = blogPreviewRoutes(input.manifest, bundle.slug, {
      ...(orbitypeDrafts === undefined
        ? {}
        : {
            orbitypeDrafts: orbitypeDrafts.map((draft) => ({
              draftId: draft.draftId,
              titleSlug: draft.titleSlug,
            })),
          }),
    });
    await input.onStage?.(stages.waitPreview);
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
      deployment,
      files,
      publication,
      ...(orbitypeDrafts === undefined ? {} : { orbitypeDrafts }),
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
      throw new DomainError('conflict_error', 'Preview approval is stale.');
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
    const deployment = await this.deployments.waitForProduction({
      mergeCommitSha: input.mergeCommitSha,
      routes: input.routes,
    });
    if (
      deployment.environment !== 'production' ||
      deployment.sha !== input.mergeCommitSha
    )
      throw new DomainError(
        'provider_final',
        'Production deployment does not contain the merge commit.',
      );
    return { deployment, mergeCommitSha: input.mergeCommitSha };
  }

  public async publish(
    input: Readonly<{
      deploymentId: string;
      expectedFiles: readonly string[];
      headCommitSha: string;
      previewSha: string;
      pullRequestId: string;
      routes: readonly string[];
    }>,
  ): Promise<
    Readonly<{
      deployment: DeploymentEvidence;
      mergeCommitSha: string;
    }>
  > {
    const merged = await this.mergeApprovedPreview(input);
    return this.verifyProduction({
      mergeCommitSha: merged.mergeCommitSha,
      routes: input.routes,
    });
  }
}

export * from './delete-blog.js';
