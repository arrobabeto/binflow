import { createHash } from 'node:crypto';

import sharp from 'sharp';

import {
  generatedBlogBundleSchema,
  type CreateBlogDraftInput,
  type GeneratedBlogBundle,
  type ProjectManifest,
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
  mime: 'text/markdown' | 'image/avif';
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

export type BlogExecutionInput = Readonly<{
  input: CreateBlogDraftInput;
  manifest: ProjectManifest;
  requestId: string;
  requestVersionId: string;
}>;

export type BlogExecutionResult = Readonly<{
  bundle: GeneratedBlogBundle;
  catalog: readonly EmbeddedCatalogItem[];
  catalogRevision: string;
  deployment: DeploymentEvidence;
  files: readonly BlogFile[];
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

export interface BlogGenerationPort {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  generate(
    input: Readonly<{
      catalog: readonly CatalogItem[];
      category: CategoryDecision;
      request: CreateBlogDraftInput;
    }>,
  ): Promise<GeneratedBlogBundle>;
  generateImage(prompt: string): Promise<Uint8Array>;
}

export interface RepositoryPublicationPort {
  createDraft(
    input: Readonly<{
      branch: string;
      files: readonly BlogFile[];
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
  revalidate(
    input: Readonly<{
      expectedFiles: readonly string[];
      expectedHeadSha: string;
      pullRequestId: string;
    }>,
  ): Promise<void>;
}

export interface DeploymentPort {
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
    const expression = new RegExp(
      `^${pattern
        .replaceAll(/[.+?^${}()|[\]\\]/gu, '\\$&')
        .replaceAll('**', '.*')
        .replaceAll('*', '[^/]*')}$`,
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

export const renderWebbinArtifacts = async (
  input: Readonly<{
    bundle: GeneratedBlogBundle;
    imageSource: Uint8Array;
    manifest: ProjectManifest;
    publicationDate: string;
  }>,
): Promise<readonly BlogFile[]> => {
  const bundle = generatedBlogBundleSchema.parse(input.bundle);
  const image = await toAvif(input.imageSource);
  await assertAvif(image);
  const esPath = `src/content/articulos-es/${bundle.slug}.md`;
  const enPath = `src/content/articulos/${bundle.slug}.md`;
  const imagePath = `public/images/articles/${bundle.slug}.avif`;
  const rawFiles = [
    {
      bytes: new TextEncoder().encode(
        renderArticle(bundle.es, bundle.slug, input.publicationDate),
      ),
      mime: 'text/markdown' as const,
      path: esPath,
    },
    {
      bytes: new TextEncoder().encode(
        renderArticle(bundle.en, bundle.slug, input.publicationDate),
      ),
      mime: 'text/markdown' as const,
      path: enPath,
    },
    { bytes: image, mime: 'image/avif' as const, path: imagePath },
  ];
  if (
    rawFiles.length !== 3 ||
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
    const synchronized = await this.catalog.sync({ manifest: input.manifest });
    const intent =
      input.input.mode === 'brief' ? input.input.topic : input.input.title;
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
    const category = decideCategory(input.input.category, synchronized.items);
    const generated = generatedBlogBundleSchema.parse(
      await this.generation.generate({
        catalog: synchronized.items,
        category,
        request: input.input,
      }),
    );
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
    const bundle = generatedBlogBundleSchema.parse({ ...generated, slug });
    const image = await this.generation.generateImage(bundle.imagePrompt);
    const publicationDate =
      input.input.publicationDate ?? new Date().toISOString().slice(0, 10);
    const files = await renderWebbinArtifacts({
      bundle,
      imageSource: image,
      manifest: input.manifest,
      publicationDate,
    });
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
      publication.files.length !== 3 ||
      !files.every((file) => publication.files.includes(file.path))
    )
      throw new DomainError(
        'provider_final',
        'Repository draft evidence does not match the rendered artifacts.',
      );
    const routes = [
      `/es/articulos/${bundle.slug}`,
      `/articulos/${bundle.slug}`,
    ];
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
      publication,
      similarity,
    };
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
    if (input.previewSha !== input.headCommitSha)
      throw new DomainError('conflict_error', 'Preview approval is stale.');
    await this.repository.revalidate({
      expectedFiles: input.expectedFiles,
      expectedHeadSha: input.headCommitSha,
      pullRequestId: input.pullRequestId,
    });
    const merged = await this.repository.merge({
      expectedHeadSha: input.headCommitSha,
      pullRequestId: input.pullRequestId,
    });
    const deployment = await this.deployments.waitForProduction({
      mergeCommitSha: merged.mergeCommitSha,
      routes: input.routes,
    });
    if (
      deployment.environment !== 'production' ||
      deployment.sha !== merged.mergeCommitSha
    )
      throw new DomainError(
        'provider_final',
        'Production deployment does not contain the merge commit.',
      );
    return { deployment, mergeCommitSha: merged.mergeCommitSha };
  }
}
