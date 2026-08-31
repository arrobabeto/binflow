import {
  type DeleteProjectAstroInput,
  type ProjectManifest,
  webbinPilotBinding,
} from '@binflow/contracts';
import { DomainError } from '@binflow/domain';

import type {
  CatalogItem,
  ContentCatalogPort,
  DeploymentEvidence,
  DeploymentPort,
  DraftPublication,
  RepositoryPublicationPort,
} from './index.js';

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export type ResolvedDeleteTarget = Readonly<{
  resolvedSlug: string;
  resolvedTitle: string;
  resolvedUrl: string;
  source: 'title' | 'url';
}>;

export type DeleteProjectExecutionInput = Readonly<{
  input: Extract<DeleteProjectAstroInput, { mode: 'execute' }>;
  manifest: ProjectManifest;
  onStage?: (node: string) => Promise<void>;
  productionOrigin: string;
  requestId: string;
}>;

export type DeleteProjectExecutionResult = Readonly<{
  catalog: readonly CatalogItem[];
  catalogRevision: string;
  deletionPaths: readonly string[];
  deployment: DeploymentEvidence;
  publication: DraftPublication;
  resolvedSlug: string;
  resolvedTitle: string;
  routes: readonly string[];
}>;

const requirePortfolioManifest = (
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

const portfolioCatalogItems = (
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

const portfolioPreviewRoutes = (
  manifest: ProjectManifest,
  slug: string,
): readonly string[] => {
  const portfolio = requirePortfolioManifest(manifest);
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

export const buildDeletionPaths = (
  slug: string,
  manifest: ProjectManifest,
): readonly string[] => {
  const portfolio = requirePortfolioManifest(manifest);
  const paths = new Set<string>();
  for (const collection of Object.values(portfolio.collections)) {
    if (collection === undefined) continue;
    paths.add(`${collection.directory}/${slug}.md`);
  }
  const imageDir = portfolio.imageDirectory;
  for (const ext of ['avif', 'jpg'] as const) {
    const coverPath = `${imageDir}/${slug}.${ext}`;
    const coverAllowed = portfolio.editablePaths.some(
      (pattern) =>
        pattern === coverPath ||
        pattern === `${imageDir}/*.${ext}` ||
        pattern.endsWith(`/*.${ext}`),
    );
    if (coverAllowed) paths.add(coverPath);
  }
  return [...paths].sort();
};

export const buildDeletionRoutes = (
  slug: string,
  manifest: ProjectManifest,
): readonly string[] => portfolioPreviewRoutes(manifest, slug);

export const composeProjectUrl = (
  origin: string,
  manifest: ProjectManifest,
  slug: string,
  locale: keyof NonNullable<
    ProjectManifest['content']['portfolio']
  >['collections'] = manifest.slugLocale,
): string => {
  const portfolio = requirePortfolioManifest(manifest);
  const collection = portfolio.collections[locale];
  if (collection === undefined)
    throw new DomainError(
      'validation_error',
      'Manifest locale collection is missing.',
    );
  return `${origin.replace(/\/$/u, '')}${collection.routePrefix}/${slug}`;
};

export const parseSlugFromProjectUrl = (
  url: string,
  manifest: ProjectManifest,
): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const pathname = parsed.pathname.replace(/\/$/u, '');
  const portfolio = manifest.content.portfolio;
  if (portfolio === undefined) return null;
  for (const collection of Object.values(portfolio.collections)) {
    if (collection === undefined) continue;
    const prefix = collection.routePrefix.replace(/\/$/u, '');
    if (pathname.startsWith(`${prefix}/`)) {
      const slug = pathname.slice(prefix.length + 1);
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return slug;
    }
  }
  return null;
};

const pickPreferredCatalogMatch = (
  matches: readonly CatalogItem[],
  manifest: ProjectManifest,
): CatalogItem => {
  const slugs = new Set(matches.map((item) => item.slug));
  if (slugs.size > 1)
    throw new DomainError(
      'validation_error',
      'Multiple projects match that title.',
      { code: 'ambiguous_title' },
    );
  return (
    matches.find((item) => item.locale === manifest.slugLocale) ?? matches[0]!
  );
};

export const resolveDeleteTarget = (
  catalog: readonly CatalogItem[],
  manifest: ProjectManifest,
  input: Readonly<{
    productionOrigin: string;
    targetTitle?: string;
    targetUrl?: string;
  }>,
): ResolvedDeleteTarget => {
  const portfolioItems = portfolioCatalogItems(manifest, catalog);
  const title = input.targetTitle?.trim();
  const url = input.targetUrl?.trim();
  if (url !== undefined && url.length > 0) {
    const slug = parseSlugFromProjectUrl(url, manifest);
    if (slug === null)
      throw new DomainError(
        'validation_error',
        'Project URL does not match manifest route prefixes.',
        { code: 'project_not_found' },
      );
    const published = portfolioItems.filter((item) => item.slug === slug);
    if (published.length === 0)
      throw new DomainError(
        'validation_error',
        'No published project matches that URL.',
        { code: 'project_not_found' },
      );
    const match = pickPreferredCatalogMatch(published, manifest);
    return {
      resolvedSlug: slug,
      resolvedTitle: match.title,
      resolvedUrl: url,
      source: 'url',
    };
  }
  if (title === undefined || title.length === 0)
    throw new DomainError(
      'validation_error',
      'Delete target requires a title or URL.',
      { code: 'project_not_found' },
    );
  const normalized = normalizeText(title);
  const matches = portfolioItems.filter(
    (item) => normalizeText(item.title) === normalized,
  );
  if (matches.length === 0)
    throw new DomainError(
      'validation_error',
      'No published project matches that title.',
      { code: 'project_not_found' },
    );
  const match = pickPreferredCatalogMatch(matches, manifest);
  return {
    resolvedSlug: match.slug,
    resolvedTitle: match.title,
    resolvedUrl: composeProjectUrl(
      input.productionOrigin,
      manifest,
      match.slug,
    ),
    source: 'title',
  };
};

export const assertDeletionPathsExist = async (
  repository: RepositoryPublicationPort,
  manifest: ProjectManifest,
  deletionPaths: readonly string[],
): Promise<readonly string[]> => {
  const ref = manifest.repository.productionBranch;
  const existing = (
    await Promise.all(
      deletionPaths.map(async (path) => {
        const bytes = await repository.readFileAtRef({ path, ref });
        return bytes === null ? null : path;
      }),
    )
  ).filter((path): path is string => path !== null);
  const contentPaths = existing.filter((path) => path.endsWith('.md'));
  if (contentPaths.length === 0)
    throw new DomainError(
      'validation_error',
      'Project content is no longer in the repository.',
      { code: 'project_not_found' },
    );
  return [...existing].sort();
};

const buildDeletionApprovalDeployment = (
  publication: DraftPublication,
  routes: readonly string[],
): DeploymentEvidence => ({
  deploymentId: `deletion-pr:${publication.headCommitSha}`,
  environment: 'preview',
  readyAt: new Date().toISOString(),
  sha: publication.headCommitSha,
  urls: Object.fromEntries(
    routes.map((route) => [route, publication.pullRequestUrl]),
  ),
});

export class DeleteProjectExecutor {
  public constructor(
    private readonly catalogPort: ContentCatalogPort,
    private readonly repository: RepositoryPublicationPort,
    private readonly deployments: DeploymentPort,
  ) {}

  public async execute(
    input: DeleteProjectExecutionInput,
  ): Promise<DeleteProjectExecutionResult> {
    await input.onStage?.('catalog_sync');
    const synchronized = await this.catalogPort.sync({
      manifest: input.manifest,
    });
    await input.onStage?.('resolve_target');
    const resolvedTitle = input.input.resolvedTitle;
    if (resolvedTitle === undefined || resolvedTitle.length === 0)
      throw new DomainError(
        'validation_error',
        'Delete execute input is missing resolved title.',
      );
    const resolved = {
      resolvedSlug: input.input.resolvedSlug,
      resolvedTitle,
      resolvedUrl: input.input.resolvedUrl,
    };
    await input.onStage?.('validate_deletion');
    const candidatePaths = buildDeletionPaths(resolved.resolvedSlug, input.manifest);
    if (candidatePaths.length === 0)
      throw new DomainError(
        'validation_error',
        'Manifest produced an empty deletion set.',
        { code: 'project_not_found' },
      );
    const deletionPaths = await assertDeletionPathsExist(
      this.repository,
      input.manifest,
      candidatePaths,
    );
    await input.onStage?.('render_deletion_artifacts');
    const routes = buildDeletionRoutes(resolved.resolvedSlug, input.manifest);
    await input.onStage?.('open_deletion_pr');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'delete-project')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', resolved.resolvedSlug);
    const publication = await this.repository.createDraft({
      branch,
      deletions: deletionPaths,
      files: [],
      requestId: input.requestId,
      slug: resolved.resolvedSlug,
    });
    const expectedFiles = [...deletionPaths].sort();
    if (
      publication.headCommitSha.length < 7 ||
      publication.files.length !== expectedFiles.length ||
      JSON.stringify([...publication.files].sort()) !==
        JSON.stringify(expectedFiles)
    )
      throw new DomainError(
        'provider_final',
        'Repository deletion draft does not match the rendered artifacts.',
      );
    const deployment = buildDeletionApprovalDeployment(publication, routes);
    return {
      catalog: portfolioCatalogItems(input.manifest, synchronized.items),
      catalogRevision: synchronized.revision,
      deletionPaths,
      deployment,
      publication,
      resolvedSlug: resolved.resolvedSlug,
      resolvedTitle: resolved.resolvedTitle,
      routes,
    };
  }

  public async mergeApprovedPreview(
    input: Readonly<{
      expectedFiles: readonly string[];
      headCommitSha: string;
      previewSha: string;
      pullRequestId: string;
    }>,
  ): Promise<Readonly<{ mergeCommitSha: string }>> {
    if (input.previewSha !== input.headCommitSha)
      throw new DomainError('conflict_error', 'Deletion PR approval is stale.');
    await this.repository.revalidate({
      expectedFiles: input.expectedFiles,
      expectedHeadSha: input.headCommitSha,
      pullRequestId: input.pullRequestId,
      requireCommitStatus: false,
    });
    return this.repository.merge({
      expectedHeadSha: input.headCommitSha,
      pullRequestId: input.pullRequestId,
    });
  }

  public async verifyProductionAbsence(
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
    const deployment = await this.deployments.verifyAbsence({
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
      expectedFiles: readonly string[];
      headCommitSha: string;
      mergeCommitSha?: string;
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
    return this.verifyProductionAbsence({
      mergeCommitSha: merged.mergeCommitSha,
      routes: input.routes,
    });
  }
}

/**
 * Client-visible origin for delete URL compose / resolve.
 * Prefer frozen manifest `deployment.productionOrigin` (ADR-0048).
 * Webbin/`astro_repo` may omit it and fall back to the pilot constant.
 */
export const resolveDeleteProjectProductionOrigin = (
  manifest?: Pick<ProjectManifest, 'deployment' | 'profile'> | null,
): string => {
  const fromManifest = manifest?.deployment?.productionOrigin;
  if (typeof fromManifest === 'string' && fromManifest.trim().length > 0)
    return fromManifest.replace(/\/$/u, '');
  if (manifest?.profile === 'astro_orbitype')
    throw new DomainError(
      'validation_error',
      'Manifest deployment.productionOrigin is required for this profile.',
      { code: 'production_origin_required' },
    );
  return webbinPilotBinding.productionOrigin;
};

/** @deprecated Prefer resolveDeleteProjectProductionOrigin(manifest). */
export const defaultDeleteProjectProductionOrigin = (): string =>
  resolveDeleteProjectProductionOrigin(null);
