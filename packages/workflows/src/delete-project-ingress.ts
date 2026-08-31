import {
  deleteProjectAstroInputSchema,
  type DeleteProjectAstroInput,
  type SupportedLocale,
} from '@binflow/contracts';
import {
  composeProjectUrl,
  resolveDeleteProjectProductionOrigin,
  parseSlugFromProjectUrl,
  resolveDeleteTarget,
  type CatalogItem,
} from '@binflow/projects';
import type { ProjectManifest } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type { ContentSchemaDocument } from '@binflow/tools';

const URL_PATTERN = /https?:\/\/[^\s]+/iu;

export const extractDeleteProjectFacts = (
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
  const titleField = contentSchema.fields.find(
    (field) => field.id === 'targetTitle',
  );
  if (titleField !== undefined) facts.targetTitle = trimmed;
  return facts;
};

export const scoreDeleteProjectCollection = (
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

export const resolveDeleteProjectTargetForPlan = (
  catalog: readonly CatalogItem[],
  manifest: ProjectManifest,
  closedFacts: Record<string, unknown>,
): ReturnType<typeof resolveDeleteTarget> =>
  resolveDeleteTarget(catalog, manifest, {
    productionOrigin: resolveDeleteProjectProductionOrigin(manifest),
    ...(typeof closedFacts.targetTitle === 'string'
      ? { targetTitle: closedFacts.targetTitle }
      : {}),
    ...(typeof closedFacts.targetUrl === 'string'
      ? { targetUrl: closedFacts.targetUrl }
      : {}),
  });

export const deleteProjectNotFoundMessage = {
  de: 'Dieses Projekt existiert nicht mehr oder wurde bereits gelöscht.',
  en: 'That project no longer exists or was already deleted.',
  es: 'Ese proyecto ya no existe o ya fue eliminado.',
} as const;

export const buildDeleteProjectNotFoundMessage = (
  locale: SupportedLocale,
): string => deleteProjectNotFoundMessage[locale];

export const isDeleteProjectNotFoundError = (error: unknown): boolean =>
  error instanceof DomainError && error.metadata.code === 'project_not_found';

export const deleteProjectActionLabels = {
  de: {
    confirmPlan: 'Projekt löschen',
    confirmTarget: 'Ja, dieses',
  },
  en: {
    confirmPlan: 'Delete project',
    confirmTarget: 'Yes, this one',
  },
  es: {
    confirmPlan: 'Borrar proyecto',
    confirmTarget: 'Sí, es este',
  },
} as const;

export const buildDeleteProjectPlanMessage = (
  locale: SupportedLocale,
  _manifest: ProjectManifest,
  target: ReturnType<typeof resolveDeleteTarget>,
): string => {
  const localeCopy = {
    de: (title: string, url: string) =>
      `Plan: Portfolio-Projekt **${title}** löschen.\nURL: ${url}`,
    en: (title: string, url: string) =>
      `Plan: delete portfolio project **${title}**.\nURL: ${url}`,
    es: (title: string, url: string) =>
      `Plan: borrar el proyecto **${title}**.\nURL: ${url}`,
  } as const;
  return localeCopy[locale](target.resolvedTitle, target.resolvedUrl);
};

export const buildDeleteProjectUrlConfirmMessage = (
  locale: SupportedLocale,
  target: ReturnType<typeof resolveDeleteTarget>,
): string => {
  const copy = {
    de: (title: string, url: string) =>
      `Portfolio-Projekt **${title}** löschen? URL: ${url}`,
    en: (title: string, url: string) =>
      `Delete portfolio project **${title}**? URL: ${url}`,
    es: (title: string, url: string) =>
      `¿Quieres borrar el proyecto **${title}**? URL: ${url}`,
  } as const;
  return copy[locale](target.resolvedTitle, target.resolvedUrl);
};

export const parseDeleteProjectExecuteInput = (
  projectId: string,
  closedFacts: Record<string, unknown>,
  target: ReturnType<typeof resolveDeleteTarget>,
): Extract<DeleteProjectAstroInput, { mode: 'execute' }> => {
  const parsed = deleteProjectAstroInputSchema.parse({
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
    throw new Error('Delete project execute input expected.');
  return parsed;
};

export const previewDeleteProjectUrl = (
  manifest: ProjectManifest,
  slug: string,
): string =>
  composeProjectUrl(resolveDeleteProjectProductionOrigin(manifest), manifest, slug);

export const tryParseDeleteProjectTargetUrl = (
  url: string,
  manifest: ProjectManifest,
): string | null => parseSlugFromProjectUrl(url, manifest);
