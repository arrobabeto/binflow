import { parse as parseYaml } from 'yaml';

import { DomainError } from '@binflow/domain';
import type { ImageEditCandidate } from '@binflow/contracts';

export const DEFAULT_SURFACE_INVENTORY_PATH =
  'binflow/surface-inventory.yaml' as const;

export type SurfaceInventoryImageRow = Readonly<{
  altLocator?: string;
  area: string;
  bfId: string;
  kind: 'image';
  locales: readonly string[];
  locator: string;
  path: string;
  publicationTarget: 'github_theme';
  sample?: string;
  section: string;
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

export const parseSurfaceInventoryImages = (
  rawYaml: string,
): readonly SurfaceInventoryImageRow[] => {
  let document: unknown;
  try {
    document = parseYaml(rawYaml);
  } catch {
    throw new DomainError(
      'validation_error',
      'Surface inventory YAML is invalid.',
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

  const rows: SurfaceInventoryImageRow[] = [];
  for (const entry of surfaces) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    if (record.kind !== 'image') continue;
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
    const altLocator = asString(record.alt_locator);
    rows.push({
      area,
      bfId,
      kind: 'image',
      locales: asStringArray(record.locales),
      locator,
      path,
      publicationTarget: 'github_theme',
      section,
      ...(sample === undefined ? {} : { sample }),
      ...(altLocator === undefined ? {} : { altLocator }),
    });
  }
  return Object.freeze(rows);
};

export const inventoryRowToImageEditCandidate = (
  row: SurfaceInventoryImageRow,
): ImageEditCandidate => {
  const assetPath =
    row.sample ??
    `assets/${row.bfId.replaceAll('.', '-')}.png`;
  return {
    component: null,
    currentPath: assetPath,
    field: row.locator,
    key: row.bfId,
    kind: 'page',
    label: `${row.bfId} · ${assetPath}`,
    pageOrPostId: row.bfId,
    pageOrPostSlug: row.area,
    pageOrPostTitle: `${row.area}/${row.section}`,
    sectionIndex: 0,
  };
};

export const searchInventoryImages = (
  rows: readonly SurfaceInventoryImageRow[],
  query: string,
): readonly ImageEditCandidate[] => {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const matches = rows.filter((row) => {
    const haystack = [
      row.bfId,
      row.area,
      row.section,
      row.path,
      row.locator,
      row.sample ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
  return matches.map(inventoryRowToImageEditCandidate);
};

/** Unique inventory areas (pages) that have at least one allowlisted image. */
export const listInventoryImageAreas = (
  rows: readonly SurfaceInventoryImageRow[],
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

export const inventoryImagesForArea = (
  rows: readonly SurfaceInventoryImageRow[],
  area: string,
): readonly ImageEditCandidate[] => {
  const needle = area.trim().toLowerCase();
  if (needle.length === 0) return [];
  return rows
    .filter((row) => row.area.toLowerCase() === needle)
    .map(inventoryRowToImageEditCandidate);
};

export const resolveInventoryImageCandidate = (
  rows: readonly SurfaceInventoryImageRow[],
  key: string,
): ImageEditCandidate => {
  const row = rows.find((candidate) => candidate.bfId === key);
  if (row === undefined)
    throw new DomainError(
      'validation_error',
      'Editable theme image target was not found.',
      { code: 'image_target_not_found' },
    );
  return inventoryRowToImageEditCandidate(row);
};
