import {
  deleteBlogDraftInputSchema,
  type DeleteBlogDraftInput,
  type SupportedLocale,
} from '@binflow/contracts';
import {
  composeBlogArticleUrl,
  defaultDeleteBlogProductionOrigin,
  parseSlugFromBlogUrl,
  resolveDeleteTarget,
  type CatalogItem,
} from '@binflow/blog';
import type { ProjectManifest } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type { ContentSchemaDocument } from '@binflow/tools';

const URL_PATTERN = /https?:\/\/[^\s]+/iu;

export const extractDeleteBlogFacts = (
  message: string,
  contentSchema: ContentSchemaDocument,
): Record<string, unknown> => {
  const facts: Record<string, unknown> = {};
  const trimmed = message.trim();
  if (trimmed.length === 0) return facts;
  const urlMatch = URL_PATTERN.exec(trimmed);
  if (urlMatch?.[0] !== undefined) {
    facts.targetUrl = urlMatch[0];
    return facts;
  }
  const titleField = contentSchema.fields.find((field) => field.id === 'targetTitle');
  if (titleField !== undefined) facts.targetTitle = trimmed;
  return facts;
};

export const scoreDeleteBlogCollection = (
  closedFacts: Record<string, unknown>,
): Readonly<{
  closed: boolean;
  needsUrlConfirm: boolean;
  openFieldIds: readonly string[];
}> => {
  const hasUrl =
    typeof closedFacts.targetUrl === 'string' && closedFacts.targetUrl.length > 0;
  const hasTitle =
    typeof closedFacts.targetTitle === 'string' &&
    closedFacts.targetTitle.length > 0;
  const targetConfirmed = closedFacts.targetConfirmed === true;
  if (!hasUrl && !hasTitle)
    return { closed: false, needsUrlConfirm: false, openFieldIds: ['targetTitle'] };
  if (hasUrl)
    return { closed: true, needsUrlConfirm: false, openFieldIds: [] };
  if (hasTitle && !targetConfirmed)
    return { closed: false, needsUrlConfirm: true, openFieldIds: [] };
  if (hasTitle && targetConfirmed)
    return { closed: true, needsUrlConfirm: false, openFieldIds: [] };
  return { closed: false, needsUrlConfirm: false, openFieldIds: ['targetTitle'] };
};

export const resolveDeleteBlogTargetForPlan = (
  catalog: readonly CatalogItem[],
  manifest: ProjectManifest,
  closedFacts: Record<string, unknown>,
): ReturnType<typeof resolveDeleteTarget> =>
  resolveDeleteTarget(catalog, manifest, {
    productionOrigin: defaultDeleteBlogProductionOrigin(),
    ...(typeof closedFacts.targetTitle === 'string'
      ? { targetTitle: closedFacts.targetTitle }
      : {}),
    ...(typeof closedFacts.targetUrl === 'string'
      ? { targetUrl: closedFacts.targetUrl }
      : {}),
  });

export const deleteBlogArticleNotFoundMessage = {
  de: 'Dieser Artikel existiert nicht mehr oder wurde bereits gelöscht.',
  en: 'That article no longer exists or was already deleted.',
  es: 'Ese artículo ya no existe o ya fue eliminado.',
} as const;

export const buildDeleteBlogArticleNotFoundMessage = (
  locale: SupportedLocale,
): string => deleteBlogArticleNotFoundMessage[locale];

export const isDeleteBlogArticleNotFoundError = (error: unknown): boolean =>
  error instanceof DomainError && error.metadata.code === 'article_not_found';

/**
 * Inline button labels for delete_blog — must not reuse create-flow CTAs
 * (`Crear borrador` / `Create draft`). Bound to confirm_plan /
 * confirm_delete_target actions, not to create_draft nodes.
 */
export const deleteBlogActionLabels = {
  de: {
    confirmPlan: 'Beitrag löschen',
    confirmTarget: 'Ja, dieser',
  },
  en: {
    confirmPlan: 'Delete post',
    confirmTarget: 'Yes, this one',
  },
  es: {
    confirmPlan: 'Borrar artículo',
    confirmTarget: 'Sí, es este',
  },
} as const;

export const buildDeleteBlogPlanMessage = (
  locale: SupportedLocale,
  _manifest: ProjectManifest,
  target: ReturnType<typeof resolveDeleteTarget>,
): string => {
  const localeCopy = {
    de: (title: string, url: string) =>
      `Plan: Blogbeitrag **${title}** löschen.\nURL: ${url}`,
    en: (title: string, url: string) =>
      `Plan: delete blog post **${title}**.\nURL: ${url}`,
    es: (title: string, url: string) =>
      `Plan: borrar el artículo **${title}**.\nURL: ${url}`,
  } as const;
  return localeCopy[locale](target.resolvedTitle, target.resolvedUrl);
};

export const buildDeleteBlogUrlConfirmMessage = (
  locale: SupportedLocale,
  target: ReturnType<typeof resolveDeleteTarget>,
): string => {
  const copy = {
    de: (title: string, url: string) =>
      `Blogbeitrag **${title}** löschen? URL: ${url}`,
    en: (title: string, url: string) =>
      `Delete blog post **${title}**? URL: ${url}`,
    es: (title: string, url: string) =>
      `¿Quieres borrar el artículo **${title}**? URL: ${url}`,
  } as const;
  return copy[locale](target.resolvedTitle, target.resolvedUrl);
};

export const parseDeleteBlogExecuteInput = (
  projectId: string,
  closedFacts: Record<string, unknown>,
  target: ReturnType<typeof resolveDeleteTarget>,
): Extract<DeleteBlogDraftInput, { mode: 'execute' }> => {
  const parsed = deleteBlogDraftInputSchema.parse({
    mode: 'execute',
    projectId,
    resolvedSlug: target.resolvedSlug,
    resolvedTitle: target.resolvedTitle,
    resolvedUrl: target.resolvedUrl,
    ...(typeof closedFacts.targetTitle === 'string'
      ? { targetTitle: closedFacts.targetTitle }
      : {}),
    ...(typeof closedFacts.targetUrl === 'string'
      ? { targetUrl: closedFacts.targetUrl }
      : {}),
  });
  if (parsed.mode !== 'execute')
    throw new Error('Delete blog execute input expected.');
  return parsed;
};

export const catalogItemsFromRows = (
  rows: readonly Readonly<{
    category: string;
    contentHash: string;
    locale: string;
    slug: string;
    sourceId: string;
    sourceRevision: string;
    title: string;
  }>[],
): readonly CatalogItem[] =>
  rows.flatMap((row) =>
    row.locale === 'es' || row.locale === 'en'
      ? [{ ...row, locale: row.locale }]
      : [],
  );

export const tryParseDeleteTargetUrl = (
  url: string,
  manifest: ProjectManifest,
): string | null => parseSlugFromBlogUrl(url, manifest);

export const previewDeleteBlogUrl = (
  manifest: ProjectManifest,
  slug: string,
): string =>
  composeBlogArticleUrl(defaultDeleteBlogProductionOrigin(), manifest, slug);
