import type { SupportedLocale } from '@binflow/contracts';
import type { OrbitypePageSnapshot } from '@binflow/menu';

export type TextEditField = Readonly<{
  field: string;
  sectionIndex: number;
}>;

export type TextEditCandidate = Readonly<{
  currentValue: string;
  field: string;
  key: string;
  label: string;
  locale: SupportedLocale;
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  sectionIndex: number;
}>;

const DENIED_FIELD_NAMES = new Set([
  'ctaHref',
  'ctaLabel',
  'ctaSecondaryHref',
  'ctaSecondaryLabel',
]);

const DENIED_FIELD_PATTERN =
  /(?:^|_)(?:cta|href|link|button|nav|footer|menu)(?:$|_)/iu;

const ALLOWED_FIELD_NAMES = new Set([
  'body',
  'content',
  'copy',
  'description',
  'heading',
  'intro',
  'lead',
  'paragraph',
  'subheading',
  'subtitle',
  'text',
  'title',
]);

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const buildTextEditKey = (
  pageSlug: string,
  sectionIndex: number,
  field: string,
  locale: SupportedLocale,
): string => `${pageSlug}:${sectionIndex}:${field}:${locale}`;

const localeLabel = (
  value: unknown,
  locales: readonly SupportedLocale[],
): string => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const locale of locales) {
      const candidate = (value as Record<string, unknown>)[locale];
      if (typeof candidate === 'string' && candidate.trim().length > 0)
        return candidate.trim();
    }
    for (const candidate of Object.values(value as Record<string, unknown>)) {
      if (typeof candidate === 'string' && candidate.trim().length > 0)
        return candidate.trim();
    }
  }
  return '';
};

const localeString = (
  value: unknown,
  locale: SupportedLocale,
): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = (value as Record<string, unknown>)[locale];
    if (typeof candidate === 'string' && candidate.trim().length > 0)
      return candidate.trim();
  }
  return null;
};

const pageTitleFromSnapshot = (
  title: unknown,
  locales: readonly SupportedLocale[],
): string => localeLabel(title, locales) || 'Page';

const isDeniedField = (field: string): boolean =>
  DENIED_FIELD_NAMES.has(field) || DENIED_FIELD_PATTERN.test(field);

const isAllowedField = (field: string): boolean =>
  ALLOWED_FIELD_NAMES.has(field) && !isDeniedField(field);

const sectionCandidates = (
  page: OrbitypePageSnapshot,
  locales: readonly SupportedLocale[],
  contentLocale: SupportedLocale,
): readonly TextEditCandidate[] => {
  if (!Array.isArray(page.sections)) return [];
  const pageTitle = pageTitleFromSnapshot(page.title, locales);
  const results: TextEditCandidate[] = [];
  for (let sectionIndex = 0; sectionIndex < page.sections.length; sectionIndex += 1) {
    const section = page.sections[sectionIndex];
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      continue;
    for (const [field, rawValue] of Object.entries(
      section as Record<string, unknown>,
    )) {
      if (field.startsWith('_')) continue;
      if (!isAllowedField(field)) continue;
      const currentValue = localeString(rawValue, contentLocale);
      if (currentValue === null || currentValue.length === 0) continue;
      results.push({
        currentValue,
        field,
        key: buildTextEditKey(page.slug, sectionIndex, field, contentLocale),
        label: currentValue.length > 80 ? `${currentValue.slice(0, 77)}…` : currentValue,
        locale: contentLocale,
        pageId: page.id,
        pageSlug: page.slug,
        pageTitle,
        sectionIndex,
      });
    }
  }
  return results;
};

export const discoverEditableCopy = (
  pages: readonly OrbitypePageSnapshot[],
  locales: readonly SupportedLocale[],
  contentLocale: SupportedLocale,
): readonly TextEditCandidate[] =>
  pages.flatMap((page) => sectionCandidates(page, locales, contentLocale));

export const searchEditableCopy = (
  pages: readonly OrbitypePageSnapshot[],
  locales: readonly SupportedLocale[],
  contentLocale: SupportedLocale,
  query: string,
): readonly TextEditCandidate[] => {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length === 0) return [];
  return discoverEditableCopy(pages, locales, contentLocale).filter((candidate) =>
    normalizeText(candidate.currentValue).includes(normalizedQuery),
  );
};

export const resolveTextEditCandidate = (
  pages: readonly OrbitypePageSnapshot[],
  locales: readonly SupportedLocale[],
  key: string,
): TextEditCandidate | null => {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  const [pageSlug, sectionIndexRaw, field, localeRaw] = parts;
  const sectionIndex = Number(sectionIndexRaw);
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return null;
  if (
    localeRaw !== 'de' &&
    localeRaw !== 'en' &&
    localeRaw !== 'es'
  )
    return null;
  const contentLocale = localeRaw;
  const page = pages.find((entry) => entry.slug === pageSlug);
  if (page === undefined) return null;
  const match = sectionCandidates(page, locales, contentLocale).find(
    (candidate) => candidate.key === key,
  );
  return match ?? null;
};

export const applyTextFieldPatch = (
  sections: unknown,
  patch: Readonly<{
    field: string;
    locale: SupportedLocale;
    newValue: string;
    sectionIndex: number;
  }>,
): unknown => {
  if (!Array.isArray(sections))
    throw new Error('Page sections must be an array.');
  const next = structuredClone(sections);
  const section = next[patch.sectionIndex];
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    throw new Error('Target section is missing.');
  const record = section as Record<string, unknown>;
  const current = record[patch.field];
  if (typeof current === 'string') {
    record[patch.field] = patch.newValue;
    return next;
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    (current as Record<string, unknown>)[patch.locale] = patch.newValue;
    return next;
  }
  record[patch.field] = { [patch.locale]: patch.newValue };
  return next;
};

export const assertTextFieldStillMatches = (
  pages: readonly OrbitypePageSnapshot[],
  candidate: TextEditCandidate,
  locales: readonly SupportedLocale[],
): void => {
  const resolved = resolveTextEditCandidate(pages, locales, candidate.key);
  if (resolved === null || resolved.currentValue !== candidate.currentValue)
    throw new Error('text_target_stale');
};
