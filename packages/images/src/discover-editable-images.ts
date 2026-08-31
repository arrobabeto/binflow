import type { SupportedLocale } from '@binflow/contracts';
import type { OrbitypePageSnapshot } from '@binflow/menu';

export type { OrbitypePageSnapshot } from '@binflow/menu';

export type ImageEditKind = 'page' | 'blog';

export type ImageEditCandidate = Readonly<{
  currentPath: string;
  field: string;
  key: string;
  kind: ImageEditKind;
  label: string;
  pageOrPostId: string;
  pageOrPostSlug: string;
  pageOrPostTitle: string;
  sectionIndex: number;
  component: string | null;
}>;

export type OrbitypePostSnapshot = Readonly<{
  id: string;
  img: string;
  sections: unknown;
  title: unknown;
}>;

const ALLOWED_FIELD_NAMES = new Set([
  'backgroundImage',
  'image',
  'img',
  'media',
  'photo',
  'picture',
  'src',
]);

const PAGE_DENIED_FIELD_PATTERN =
  /(?:^|_)(?:logo|brandLogo|nav|footer|hero)(?:$|_)/iu;

const LOGO_OR_BRAND_PREFIX = /^(?:logo|brand)/iu;

const normalizeText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const buildImageEditKey = (
  kind: ImageEditKind,
  slugOrId: string,
  sectionIndex: number,
  field: string,
): string => `${kind}:${slugOrId}:${sectionIndex}:${field}`;

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

const isPathLike = (value: string): boolean =>
  value.startsWith('/') ||
  value.startsWith('http://') ||
  value.startsWith('https://');

export const extractImagePath = (
  value: unknown,
  locales: readonly SupportedLocale[],
): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return isPathLike(trimmed) ? trimmed : null;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const locale of locales) {
      const candidate = record[locale];
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (isPathLike(trimmed)) return trimmed;
      }
    }
    for (const candidate of Object.values(record)) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (isPathLike(trimmed)) return trimmed;
      }
    }
  }
  return null;
};

const pathLabel = (path: string): string => {
  const base = path.split('/').pop() ?? path;
  return base.length > 80 ? `${base.slice(0, 77)}…` : base;
};

export const getSectionComponent = (
  section: Record<string, unknown>,
): string | null => {
  const orbi = section._orbi;
  if (orbi === null || typeof orbi !== 'object' || Array.isArray(orbi))
    return null;
  const component = (orbi as Record<string, unknown>).component;
  return typeof component === 'string' ? component : null;
};

const isDeniedPageHeroComponent = (component: string | null): boolean => {
  if (component === null) return false;
  if (component === 'SectionPostHero') return false;
  if (component === 'Hero') return true;
  if (/^Hero/iu.test(component)) return true;
  if (/SectionHero/iu.test(component)) return true;
  return false;
};

const isDeniedPageField = (field: string): boolean =>
  LOGO_OR_BRAND_PREFIX.test(field) || PAGE_DENIED_FIELD_PATTERN.test(field);

const isDeniedBlogField = (field: string): boolean =>
  LOGO_OR_BRAND_PREFIX.test(field);

const isAllowedImageField = (field: string): boolean =>
  ALLOWED_FIELD_NAMES.has(field);

const titleFromSnapshot = (
  title: unknown,
  locales: readonly SupportedLocale[],
  fallback: string,
): string => localeLabel(title, locales) || fallback;

const extractAltText = (
  section: Record<string, unknown>,
  locales: readonly SupportedLocale[],
): string => localeLabel(section.imgAlt, locales);

const pageSectionCandidates = (
  page: OrbitypePageSnapshot,
  locales: readonly SupportedLocale[],
): readonly ImageEditCandidate[] => {
  if (!Array.isArray(page.sections)) return [];
  const pageTitle = titleFromSnapshot(page.title, locales, 'Page');
  const results: ImageEditCandidate[] = [];
  for (let sectionIndex = 0; sectionIndex < page.sections.length; sectionIndex += 1) {
    const section = page.sections[sectionIndex];
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      continue;
    const record = section as Record<string, unknown>;
    const component = getSectionComponent(record);
    if (isDeniedPageHeroComponent(component)) continue;
    for (const [field, rawValue] of Object.entries(record)) {
      if (field.startsWith('_')) continue;
      if (!isAllowedImageField(field)) continue;
      if (isDeniedPageField(field)) continue;
      const currentPath = extractImagePath(rawValue, locales);
      if (currentPath === null) continue;
      results.push({
        component,
        currentPath,
        field,
        key: buildImageEditKey('page', page.slug, sectionIndex, field),
        kind: 'page',
        label: pathLabel(currentPath),
        pageOrPostId: page.id,
        pageOrPostSlug: page.slug,
        pageOrPostTitle: pageTitle,
        sectionIndex,
      });
    }
  }
  return results;
};

const blogSectionCandidates = (
  post: OrbitypePostSnapshot,
  locales: readonly SupportedLocale[],
): readonly ImageEditCandidate[] => {
  const postTitle = titleFromSnapshot(post.title, locales, 'Post');
  const results: ImageEditCandidate[] = [];

  const coverPath = extractImagePath(post.img, locales);
  if (coverPath !== null && !isDeniedBlogField('img')) {
    results.push({
      component: null,
      currentPath: coverPath,
      field: 'img',
      key: buildImageEditKey('blog', post.id, -1, 'img'),
      kind: 'blog',
      label: pathLabel(coverPath),
      pageOrPostId: post.id,
      pageOrPostSlug: post.id,
      pageOrPostTitle: postTitle,
      sectionIndex: -1,
    });
  }

  if (!Array.isArray(post.sections)) return results;
  for (let sectionIndex = 0; sectionIndex < post.sections.length; sectionIndex += 1) {
    const section = post.sections[sectionIndex];
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      continue;
    const record = section as Record<string, unknown>;
    const component = getSectionComponent(record);
    for (const [field, rawValue] of Object.entries(record)) {
      if (field.startsWith('_')) continue;
      if (!isAllowedImageField(field)) continue;
      if (isDeniedBlogField(field)) continue;
      const currentPath = extractImagePath(rawValue, locales);
      if (currentPath === null) continue;
      results.push({
        component,
        currentPath,
        field,
        key: buildImageEditKey('blog', post.id, sectionIndex, field),
        kind: 'blog',
        label: pathLabel(currentPath),
        pageOrPostId: post.id,
        pageOrPostSlug: post.id,
        pageOrPostTitle: postTitle,
        sectionIndex,
      });
    }
  }
  return results;
};

export const discoverEditableImages = (
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  locales: readonly SupportedLocale[],
): readonly ImageEditCandidate[] => [
  ...pages.flatMap((page) => pageSectionCandidates(page, locales)),
  ...posts.flatMap((post) => blogSectionCandidates(post, locales)),
];

const candidateAltText = (
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  locales: readonly SupportedLocale[],
  candidate: ImageEditCandidate,
): string => {
  if (candidate.sectionIndex < 0) return '';
  const sections =
    candidate.kind === 'page'
      ? pages.find((page) => page.id === candidate.pageOrPostId)?.sections
      : posts.find((post) => post.id === candidate.pageOrPostId)?.sections;
  if (!Array.isArray(sections)) return '';
  const section = sections[candidate.sectionIndex];
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    return '';
  return extractAltText(section as Record<string, unknown>, locales);
};

export const searchEditableImages = (
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  locales: readonly SupportedLocale[],
  query: string,
): readonly ImageEditCandidate[] => {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length === 0) return [];
  return discoverEditableImages(pages, posts, locales).filter((candidate) => {
    const haystacks = [
      candidate.currentPath,
      candidate.label,
      candidate.pageOrPostTitle,
      candidate.pageOrPostSlug,
      candidateAltText(pages, posts, locales, candidate),
    ];
    return haystacks.some((value) =>
      normalizeText(value).includes(normalizedQuery),
    );
  });
};

const parseImageEditKey = (
  key: string,
): Readonly<{
  field: string;
  kind: ImageEditKind;
  sectionIndex: number;
  slugOrId: string;
}> | null => {
  const match = /^(page|blog):(.+):(-?\d+):([^:]+)$/u.exec(key);
  if (match === null) return null;
  const kind = match[1] as ImageEditKind;
  const slugOrId = match[2];
  const sectionIndexRaw = match[3];
  const field = match[4];
  if (
    slugOrId === undefined ||
    sectionIndexRaw === undefined ||
    field === undefined
  )
    return null;
  const sectionIndex = Number(sectionIndexRaw);
  if (!Number.isInteger(sectionIndex)) return null;
  return { field, kind, sectionIndex, slugOrId };
};

export const resolveImageEditCandidate = (
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  locales: readonly SupportedLocale[],
  key: string,
): ImageEditCandidate | null => {
  const parsed = parseImageEditKey(key);
  if (parsed === null) return null;
  const match = discoverEditableImages(pages, posts, locales).find(
    (candidate) => candidate.key === key,
  );
  return match ?? null;
};

export const applyImageFieldPatch = (
  sections: unknown,
  patch: Readonly<{
    field: string;
    newPath: string;
    sectionIndex: number;
  }>,
): unknown => {
  if (!Array.isArray(sections))
    throw new Error('Sections must be an array.');
  const next = structuredClone(sections);
  const section = next[patch.sectionIndex];
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    throw new Error('Target section is missing.');
  const record = section as Record<string, unknown>;
  const current = record[patch.field];
  if (typeof current === 'string') {
    record[patch.field] = patch.newPath;
    return next;
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    for (const localeKey of Object.keys(current as Record<string, unknown>)) {
      (current as Record<string, unknown>)[localeKey] = patch.newPath;
    }
    return next;
  }
  record[patch.field] = patch.newPath;
  return next;
};

export const applyImageFieldPatchAllLocales = (
  sections: unknown,
  patch: Readonly<{
    field: string;
    locales: readonly SupportedLocale[];
    newPath: string;
    sectionIndex: number;
  }>,
): unknown => {
  if (!Array.isArray(sections))
    throw new Error('Sections must be an array.');
  const next = structuredClone(sections);
  const section = next[patch.sectionIndex];
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    throw new Error('Target section is missing.');
  const record = section as Record<string, unknown>;
  const current = record[patch.field];
  if (typeof current === 'string') {
    record[patch.field] = patch.newPath;
    return next;
  }
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    const map = current as Record<string, unknown>;
    for (const locale of patch.locales) {
      map[locale] = patch.newPath;
    }
    for (const localeKey of Object.keys(map)) {
      if (typeof map[localeKey] === 'string' && isPathLike(String(map[localeKey])))
        map[localeKey] = patch.newPath;
    }
    return next;
  }
  if (patch.locales.length === 0) {
    record[patch.field] = patch.newPath;
    return next;
  }
  const localeMap: Record<string, string> = {};
  for (const locale of patch.locales) {
    localeMap[locale] = patch.newPath;
  }
  record[patch.field] = localeMap;
  return next;
};

export const assertImageStillMatches = (
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  candidate: ImageEditCandidate,
  locales: readonly SupportedLocale[],
): void => {
  const resolved = resolveImageEditCandidate(
    pages,
    posts,
    locales,
    candidate.key,
  );
  if (resolved === null || resolved.currentPath !== candidate.currentPath)
    throw new Error('image_target_stale');
};
