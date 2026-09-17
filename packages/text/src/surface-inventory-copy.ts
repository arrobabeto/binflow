import { parse as parseYaml } from 'yaml';

import { DomainError } from '@binflow/domain';
import type { TextEditCandidate } from '@binflow/contracts';

export const DEFAULT_SURFACE_INVENTORY_PATH =
  'binflow/surface-inventory.yaml' as const;

export type SurfaceInventoryCopyRow = Readonly<{
  area: string;
  bfId: string;
  kind: 'copy';
  /** Live Liquid schema `"default"` when enrichment resolved it. */
  liveDefault?: string;
  /** Preferred theme template instance setting value for display. */
  liveInstance?: string;
  /** All template instance values for this setting across the theme. */
  liveInstances?: readonly string[];
  locales: readonly string[];
  locator: string;
  path: string;
  publicationTarget: 'github_theme';
  sample?: string;
  section: string;
}>;

export type SurfaceInventoryStyleHint = Readonly<{
  area: string;
  sample: string;
}>;

/** Style-target inventory row used to resolve live heading text for miss UX. */
export type SurfaceInventoryStyleTargetRow = Readonly<{
  area: string;
  bfId: string;
  locator: string;
  path: string;
  sample?: string;
}>;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

/** Normalize for substring search (same rules as Astro edit_text). */
export const normalizeInventoryCopyText = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

const truncateLabel = (value: string): string =>
  value.length > 80 ? `${value.slice(0, 77)}…` : value;

/** Shopify schema translation keys are not storefront copy. */
export const isShopifyTranslationKey = (value: string): boolean =>
  /^t:/iu.test(value.trim());

const usefulCopy = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed;
};

/** Prefer human copy over `t:` keys for confirm/display. */
export const pickInventoryCopyDisplayValue = (
  row: Pick<
    SurfaceInventoryCopyRow,
    'liveDefault' | 'liveInstance' | 'liveInstances' | 'sample'
  >,
  currentValue?: string,
): string | undefined => {
  const explicit = usefulCopy(currentValue);
  if (explicit !== undefined && !isShopifyTranslationKey(explicit))
    return stripInventoryHtml(explicit);
  const instance = usefulCopy(row.liveInstance);
  const live = usefulCopy(row.liveDefault);
  const sample = usefulCopy(row.sample);
  for (const candidate of [instance, live, sample]) {
    if (candidate === undefined) continue;
    if (isShopifyTranslationKey(candidate)) continue;
    return stripInventoryHtml(candidate);
  }
  const fallback = instance ?? live ?? sample ?? explicit;
  return fallback === undefined ? undefined : stripInventoryHtml(fallback);
};

/** Strip HTML tags so richtext schema/template values match plain excerpts. */
export const stripInventoryHtml = (value: string): string =>
  value
    .replaceAll(/<[^>]+>/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const searchableCopyValues = (
  row: Pick<
    SurfaceInventoryCopyRow,
    'liveDefault' | 'liveInstance' | 'liveInstances' | 'sample'
  >,
): readonly string[] => {
  const values: string[] = [];
  const seen = new Set<string>();
  const rawValues = [
    ...(row.liveInstances ?? []),
    row.liveInstance,
    row.liveDefault,
    row.sample,
  ];
  for (const raw of rawValues) {
    const value = usefulCopy(raw);
    if (value === undefined) continue;
    const plain = stripInventoryHtml(value);
    if (plain.length === 0) continue;
    const key = normalizeInventoryCopyText(plain);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    values.push(plain);
  }
  return values;
};

export const parseSurfaceInventoryCopy = (
  rawYaml: string,
): readonly SurfaceInventoryCopyRow[] => {
  let document: unknown;
  try {
    document = parseYaml(rawYaml);
  } catch (error) {
    const detail =
      error instanceof Error && error.message.trim().length > 0
        ? ` ${error.message}`
        : '';
    throw new DomainError(
      'validation_error',
      `Surface inventory YAML is invalid.${detail}`,
      { code: 'surface_inventory_invalid' },
    );
  }
  if (
    document === null ||
    typeof document !== 'object' ||
    Array.isArray(document)
  )
    throw new DomainError(
      'validation_error',
      'Surface inventory root must be an object.',
      { code: 'surface_inventory_invalid' },
    );
  const surfaces = (document as { surfaces?: unknown }).surfaces;
  if (!Array.isArray(surfaces))
    throw new DomainError(
      'validation_error',
      'Surface inventory must declare a surfaces array.',
      { code: 'surface_inventory_invalid' },
    );

  const rows: SurfaceInventoryCopyRow[] = [];
  for (const entry of surfaces) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    if (record.kind !== 'copy') continue;
    if (record.publication_target !== 'github_theme') continue;
    const bfId = asString(record.bf_id);
    const area = asString(record.area);
    const section = asString(record.section);
    const path = asString(record.path);
    const locator = asString(record.locator);
    if (
      bfId === undefined ||
      area === undefined ||
      section === undefined ||
      path === undefined ||
      locator === undefined
    )
      continue;
    const sample = asString(record.sample);
    rows.push({
      area,
      bfId,
      kind: 'copy',
      locales: asStringArray(record.locales),
      locator,
      path,
      publicationTarget: 'github_theme',
      section,
      ...(sample === undefined ? {} : { sample }),
    });
  }
  return Object.freeze(rows);
};

/**
 * Style-target samples for near-miss messaging (not editable via edit_text_shopify).
 * Only includes rows that already declare a non-empty inventory sample.
 */
export const parseSurfaceInventoryStyleHints = (
  rawYaml: string,
): readonly SurfaceInventoryStyleHint[] => {
  return Object.freeze(
    parseSurfaceInventoryStyleTargets(rawYaml)
      .filter((row) => usefulCopy(row.sample) !== undefined)
      .map((row) => ({
        area: row.area,
        sample: stripInventoryHtml(row.sample!),
      })),
  );
};

/**
 * All github_theme style_target rows with path + locator (sample optional).
 * Used to enrich live heading text when inventory samples are missing.
 */
export const parseSurfaceInventoryStyleTargets = (
  rawYaml: string,
): readonly SurfaceInventoryStyleTargetRow[] => {
  let document: unknown;
  try {
    document = parseYaml(rawYaml);
  } catch {
    return [];
  }
  if (
    document === null ||
    typeof document !== 'object' ||
    Array.isArray(document)
  )
    return [];
  const surfaces = (document as { surfaces?: unknown }).surfaces;
  if (!Array.isArray(surfaces)) return [];
  const rows: SurfaceInventoryStyleTargetRow[] = [];
  for (const entry of surfaces) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    if (record.kind !== 'style_target') continue;
    if (
      record.publication_target !== undefined &&
      record.publication_target !== 'github_theme'
    )
      continue;
    const bfId = asString(record.bf_id);
    const area = asString(record.area);
    const path = asString(record.path);
    const locator = asString(record.locator);
    if (
      bfId === undefined ||
      area === undefined ||
      path === undefined ||
      locator === undefined
    )
      continue;
    const sample = asString(record.sample);
    rows.push({
      area,
      bfId,
      locator,
      path,
      ...(sample === undefined ? {} : { sample }),
    });
  }
  return Object.freeze(rows);
};

/** True when query matches a style_target sample (heading reserved for style tool). */
export const matchesInventoryStyleHint = (
  hints: readonly SurfaceInventoryStyleHint[],
  query: string,
): boolean => {
  const needle = normalizeInventoryCopyText(stripInventoryHtml(query));
  if (needle.length === 0) return false;
  for (const hint of hints) {
    if (normalizeInventoryCopyText(hint.sample).includes(needle)) return true;
  }
  return false;
};

/** Last segment of locator (`settings.heading` → `heading`). */
export const settingIdFromLocator = (locator: string): string => {
  const parts = locator.trim().split('.').filter((part) => part.length > 0);
  if (parts.length === 0)
    throw new DomainError(
      'validation_error',
      'Inventory locator is empty.',
      { code: 'text_target_not_found' },
    );
  return parts[parts.length - 1]!;
};

export const inventoryRowToTextEditCandidate = (
  row: SurfaceInventoryCopyRow,
  currentValue?: string,
): TextEditCandidate | null => {
  const value = pickInventoryCopyDisplayValue(row, currentValue);
  if (value === undefined) return null;
  const locale =
    row.locales.find((item) => item === 'en' || item === 'de' || item === 'es') ??
    'en';
  return {
    currentValue: value.slice(0, 10_000),
    field: row.locator,
    key: row.bfId,
    label: truncateLabel(value),
    locale: locale as 'de' | 'en' | 'es',
    pageId: row.bfId,
    pageSlug: row.area,
    pageTitle: row.area,
    sectionIndex: 0,
  };
};

/**
 * Search allowlisted copy by normalized substring on live schema default and/or
 * inventory sample (Astro edit_text parity). Does not match bf_id / path / locator.
 */
export const searchInventoryCopy = (
  rows: readonly SurfaceInventoryCopyRow[],
  query: string,
): readonly TextEditCandidate[] => {
  const needle = normalizeInventoryCopyText(query);
  if (needle.length === 0) return [];
  const matches: TextEditCandidate[] = [];
  for (const row of rows) {
    const haystacks = searchableCopyValues(row);
    if (haystacks.length === 0) continue;
    const matched = haystacks.some((text) =>
      normalizeInventoryCopyText(text).includes(needle),
    );
    if (!matched) continue;
    const candidate = inventoryRowToTextEditCandidate(row);
    if (candidate === null) continue;
    matches.push(candidate);
  }
  return matches;
};

export const listInventoryCopyAreas = (
  rows: readonly SurfaceInventoryCopyRow[],
): readonly string[] => {
  const areas: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.area.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(row.area);
  }
  return Object.freeze(areas);
};

export const inventoryCopyForArea = (
  rows: readonly SurfaceInventoryCopyRow[],
  area: string,
): readonly TextEditCandidate[] => {
  const needle = area.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches: TextEditCandidate[] = [];
  for (const row of rows) {
    if (row.area.toLowerCase() !== needle) continue;
    const candidate = inventoryRowToTextEditCandidate(row);
    if (candidate !== null) matches.push(candidate);
  }
  return matches;
};

export const resolveInventoryCopyCandidate = (
  rows: readonly SurfaceInventoryCopyRow[],
  key: string,
  currentValue?: string,
): TextEditCandidate => {
  const row = rows.find((candidate) => candidate.bfId === key);
  if (row === undefined)
    throw new DomainError(
      'validation_error',
      'Editable theme text target was not found.',
      { code: 'text_target_not_found' },
    );
  const candidate = inventoryRowToTextEditCandidate(row, currentValue);
  if (candidate === null)
    throw new DomainError(
      'validation_error',
      'Editable theme text target has no readable copy.',
      { code: 'text_target_not_found' },
    );
  return candidate;
};
