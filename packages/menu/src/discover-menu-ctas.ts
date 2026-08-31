import type { SupportedLocale } from '@binflow/contracts';

export type MenuCtaField = 'ctaHref' | 'ctaSecondaryHref';

export type MenuCtaCandidate = Readonly<{
  currentHref: string;
  field: MenuCtaField;
  key: string;
  label: string;
  pageId: string;
  pageSlug: string;
  pageTitle: string;
  sectionIndex: number;
}>;

export type OrbitypePageSnapshot = Readonly<{
  id: string;
  sections: unknown;
  slug: string;
  title: unknown;
}>;

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const DEFAULT_MENU_CTA_KEYWORDS = Object.freeze([
  'speisekarte',
  'menu',
  'menü',
  'karte',
  'carta',
  'tagesmenu',
  'tagesmenü',
  'food menu',
  'wine list',
]);

export const buildMenuCtaKey = (
  pageSlug: string,
  sectionIndex: number,
  field: MenuCtaField,
): string => `${pageSlug}:${sectionIndex}:${field}`;

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

const pageTitleFromSnapshot = (
  title: unknown,
  locales: readonly SupportedLocale[],
): string => localeLabel(title, locales) || 'Page';

const sectionCandidates = (
  page: OrbitypePageSnapshot,
  locales: readonly SupportedLocale[],
  keywords: readonly string[],
): readonly MenuCtaCandidate[] => {
  if (!Array.isArray(page.sections)) return [];
  const normalizedKeywords = keywords.map((keyword) => normalizeText(keyword));
  const pageTitle = pageTitleFromSnapshot(page.title, locales);
  const matches: MenuCtaCandidate[] = [];
  page.sections.forEach((section, sectionIndex) => {
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      return;
    const record = section as Record<string, unknown>;
    const fields: readonly MenuCtaField[] = ['ctaHref', 'ctaSecondaryHref'];
    for (const field of fields) {
      const labelKey = field === 'ctaHref' ? 'ctaLabel' : 'ctaSecondaryLabel';
      const label = localeLabel(record[labelKey], locales);
      if (label.length === 0) continue;
      const normalizedLabel = normalizeText(label);
      const isMenu =
        normalizedKeywords.some((keyword) =>
          normalizedLabel.includes(keyword),
        ) ||
        (field === 'ctaSecondaryHref' &&
          normalizedKeywords.some((keyword) =>
            normalizeText(localeLabel(record.ctaLabel, locales)).includes(keyword),
          ));
      if (!isMenu) continue;
      const currentHref =
        typeof record[field] === 'string' ? record[field].trim() : '';
      if (currentHref.length === 0) continue;
      matches.push({
        currentHref,
        field,
        key: buildMenuCtaKey(page.slug, sectionIndex, field),
        label,
        pageId: page.id,
        pageSlug: page.slug,
        pageTitle,
        sectionIndex,
      });
    }
  });
  return matches;
};

export const discoverMenuCtas = (
  pages: readonly OrbitypePageSnapshot[],
  locales: readonly SupportedLocale[],
  extraKeywords: readonly string[] = [],
): readonly MenuCtaCandidate[] => {
  const keywords = [
    ...DEFAULT_MENU_CTA_KEYWORDS,
    ...extraKeywords.flatMap((keyword) => keyword.split(/[,;|]/u)),
  ].filter((keyword) => keyword.trim().length > 0);
  return pages
    .flatMap((page) => sectionCandidates(page, locales, keywords))
    .sort((left, right) =>
      `${left.pageSlug}:${left.label}`.localeCompare(
        `${right.pageSlug}:${right.label}`,
      ),
    );
};

export const toggleMenuCtaSelection = (
  selected: readonly string[],
  key: string,
): readonly string[] => {
  const set = new Set(selected);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set].sort();
};

export const selectAllMenuCtaKeys = (
  discovered: readonly MenuCtaCandidate[],
): readonly string[] =>
  [...discovered.map((cta) => cta.key)].sort();

export const buildVersionedMenuPdfPath = (
  requestVersionId: string,
  now = new Date(),
): string => {
  const date = now.toISOString().slice(0, 10);
  const suffix = requestVersionId.replaceAll(/[^a-zA-Z0-9]/gu, '').slice(-8);
  return `public/documents/menu-${date}-${suffix}.pdf`;
};

export const publicUrlForMenuPdfPath = (
  productionOrigin: string,
  repoPath: string,
): string => {
  const relative = repoPath.startsWith('public/')
    ? repoPath.slice('public/'.length)
    : repoPath;
  return `${productionOrigin.replace(/\/$/u, '')}/${relative}`;
};

export const applyMenuHrefPatches = (
  sections: unknown,
  patches: ReadonlyArray<
    Readonly<{
      field: MenuCtaField;
      href: string;
      sectionIndex: number;
    }>
  >,
): unknown[] => {
  if (!Array.isArray(sections))
    throw new Error('Orbitype page sections must be an array.');
  const next = structuredClone(sections) as unknown[];
  for (const patch of patches) {
    const section = next[patch.sectionIndex];
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      throw new Error('Menu CTA section index is stale.');
    (section as Record<string, unknown>)[patch.field] = patch.href;
  }
  return next;
};
