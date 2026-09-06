import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { DomainError } from '@binflow/domain';

import { DEFAULT_SURFACE_INVENTORY_PATH } from './surface-inventory.js';

export const SURFACE_MARKER_KINDS = [
  'copy',
  'style_target',
  'image',
  'chrome_denied',
  'catalog_bound',
] as const;

export type SurfaceMarkerKind = (typeof SURFACE_MARKER_KINDS)[number];

export type ExtractedSurfaceMarker = Readonly<{
  bfId: string;
  kind: SurfaceMarkerKind;
  locator?: string;
  path: string;
  sample?: string;
  section: string;
}>;

export type SurfaceInventoryRow = Readonly<{
  alt_locator?: string;
  area: string;
  bf_id: string;
  deny_reason?: string;
  kind: string;
  locales: readonly string[];
  locator: string;
  notes?: string;
  path: string;
  publication_target: string;
  sample?: string;
  section: string;
}>;

export type RemapSurfaceInventoryResult = Readonly<{
  addedBfIds: readonly string[];
  changed: boolean;
  inventoryPath: string;
  yaml: string;
}>;

const isKind = (value: string): value is SurfaceMarkerKind =>
  (SURFACE_MARKER_KINDS as readonly string[]).includes(value);

const attr = (window: string, name: string): string | undefined => {
  const match = new RegExp(
    `${name}\\s*=\\s*["']([^"']+)["']`,
    'iu',
  ).exec(window);
  const value = match?.[1]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
};

const inferSample = (window: string): string | undefined => {
  const asset = /(?:assets\/[A-Za-z0-9._/-]+\.(?:jpe?g|png|webp|gif|avif))/iu.exec(
    window,
  );
  return asset?.[0];
};

const defaultLocator = (kind: SurfaceMarkerKind): string => {
  switch (kind) {
    case 'image':
      return 'settings.image';
    case 'style_target':
    case 'copy':
      return 'settings.text';
    default:
      return 'settings.value';
  }
};

/** Extract `data-bf-*` markers from a Liquid (or HTML) source file. */
export const extractSurfaceMarkersFromSource = (
  path: string,
  source: string,
): readonly ExtractedSurfaceMarker[] => {
  const results: ExtractedSurfaceMarker[] = [];
  const seen = new Set<string>();
  const idRegex = /data-bf-id\s*=\s*["']([^"']+)["']/giu;
  let match: RegExpExecArray | null;
  while ((match = idRegex.exec(source)) !== null) {
    const bfId = match[1]?.trim();
    if (bfId === undefined || bfId.length === 0) continue;
    const start = Math.max(0, match.index - 120);
    const end = Math.min(source.length, match.index + match[0].length + 400);
    const window = source.slice(start, end);
    const kindRaw = attr(window, 'data-bf-kind');
    const section =
      attr(window, 'data-bf-section') ?? bfId.split('.')[1] ?? 'unknown';
    if (kindRaw === undefined || !isKind(kindRaw)) continue;
    const key = `${bfId}::${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const locator = attr(window, 'data-bf-locator');
    const sample = kindRaw === 'image' ? inferSample(window) : undefined;
    results.push({
      bfId,
      kind: kindRaw,
      path,
      section,
      ...(locator === undefined ? {} : { locator }),
      ...(sample === undefined ? {} : { sample }),
    });
  }
  return Object.freeze(results);
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asStringArray = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parseInventoryRows = (rawYaml: string): SurfaceInventoryRow[] => {
  if (rawYaml.trim().length === 0) return [];
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
  if (surfaces === undefined) return [];
  if (!Array.isArray(surfaces))
    throw new DomainError(
      'validation_error',
      'Surface inventory must declare a surfaces array.',
      { code: 'surface_inventory_invalid' },
    );
  const rows: SurfaceInventoryRow[] = [];
  for (const entry of surfaces) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    const bfId = asString(record.bf_id);
    const kind = asString(record.kind);
    const area = asString(record.area);
    const section = asString(record.section);
    const path = asString(record.path);
    const locator = asString(record.locator);
    const publicationTarget = asString(record.publication_target);
    if (
      bfId === undefined ||
      kind === undefined ||
      area === undefined ||
      section === undefined ||
      path === undefined ||
      locator === undefined ||
      publicationTarget === undefined
    )
      continue;
    rows.push({
      area,
      bf_id: bfId,
      kind,
      locales: asStringArray(record.locales),
      locator,
      path,
      publication_target: publicationTarget,
      section,
      ...(asString(record.sample) === undefined
        ? {}
        : { sample: asString(record.sample)! }),
      ...(asString(record.alt_locator) === undefined
        ? {}
        : { alt_locator: asString(record.alt_locator)! }),
      ...(asString(record.notes) === undefined
        ? {}
        : { notes: asString(record.notes)! }),
      ...(asString(record.deny_reason) === undefined
        ? {}
        : { deny_reason: asString(record.deny_reason)! }),
    });
  }
  return rows;
};

const areaFromBfId = (bfId: string): string =>
  bfId.split('.')[0]?.trim() || 'unknown';

const markerToRow = (
  marker: ExtractedSurfaceMarker,
  locales: readonly string[],
): SurfaceInventoryRow => ({
  area: areaFromBfId(marker.bfId),
  bf_id: marker.bfId,
  kind: marker.kind,
  locales,
  locator: marker.locator ?? defaultLocator(marker.kind),
  path: marker.path,
  publication_target: 'github_theme',
  section: marker.section,
  ...(marker.sample === undefined ? {} : { sample: marker.sample }),
});

const serializeInventory = (
  projectKey: string | undefined,
  rows: readonly SurfaceInventoryRow[],
): string => {
  const document = {
    version: 1,
    ...(projectKey === undefined || projectKey.trim().length === 0
      ? {}
      : { project_key: projectKey }),
    surfaces: rows.map((row) => {
      const entry: Record<string, unknown> = {
        bf_id: row.bf_id,
        kind: row.kind,
        area: row.area,
        section: row.section,
        path: row.path,
        locator: row.locator,
        locales: [...row.locales],
        publication_target: row.publication_target,
      };
      if (row.sample !== undefined) entry.sample = row.sample;
      if (row.alt_locator !== undefined) entry.alt_locator = row.alt_locator;
      if (row.notes !== undefined) entry.notes = row.notes;
      if (row.deny_reason !== undefined) entry.deny_reason = row.deny_reason;
      return entry;
    }),
  };
  return `${stringifyYaml(document, { lineWidth: 100 }).trimEnd()}\n`;
};

/**
 * Merge marker scan into existing inventory YAML.
 * Preserves hand-tuned locator/sample/alt_locator/notes on existing bf_ids.
 */
export const mergeSurfaceInventoryYaml = (input: Readonly<{
  existingYaml: string;
  locales?: readonly string[];
  markers: readonly ExtractedSurfaceMarker[];
  projectKey?: string;
}>): RemapSurfaceInventoryResult => {
  const locales =
    input.locales !== undefined && input.locales.length > 0
      ? input.locales
      : (['en'] as const);
  const existing = parseInventoryRows(input.existingYaml);
  const byId = new Map(existing.map((row) => [row.bf_id, row]));
  const addedBfIds: string[] = [];
  const markerIds = new Set<string>();

  for (const marker of input.markers) {
    markerIds.add(marker.bfId);
    const current = byId.get(marker.bfId);
    if (current === undefined) {
      byId.set(marker.bfId, markerToRow(marker, locales));
      addedBfIds.push(marker.bfId);
      continue;
    }
    // Preserve locator/sample/alt; refresh path/section/kind when markers differ.
    byId.set(marker.bfId, {
      ...current,
      kind: marker.kind,
      path: marker.path,
      section: marker.section,
      area: current.area || areaFromBfId(marker.bfId),
      ...(current.locator.trim().length > 0
        ? {}
        : { locator: marker.locator ?? defaultLocator(marker.kind) }),
      ...(current.sample !== undefined || marker.sample === undefined
        ? {}
        : { sample: marker.sample }),
    });
  }

  for (const row of existing) {
    if (markerIds.has(row.bf_id)) continue;
    if (row.notes !== undefined && row.notes.includes('orphaned')) continue;
    byId.set(row.bf_id, {
      ...row,
      notes:
        row.notes === undefined || row.notes.trim().length === 0
          ? 'orphaned — marker not found in last remap'
          : row.notes,
    });
  }

  const rows = [...byId.values()].sort((a, b) =>
    a.bf_id.localeCompare(b.bf_id),
  );
  const projectKey =
    input.projectKey ??
    (() => {
      try {
        const doc = parseYaml(input.existingYaml) as { project_key?: unknown };
        return asString(doc.project_key);
      } catch {
        return undefined;
      }
    })();
  const yaml = serializeInventory(projectKey, rows);
  const changed = yaml.trim() !== input.existingYaml.trim();
  return {
    addedBfIds: Object.freeze(addedBfIds),
    changed,
    inventoryPath: DEFAULT_SURFACE_INVENTORY_PATH,
    yaml,
  };
};

export const remapSurfaceInventoryFromSources = (input: Readonly<{
  existingYaml: string;
  locales?: readonly string[];
  projectKey?: string;
  sources: readonly Readonly<{ path: string; source: string }>[];
}>): RemapSurfaceInventoryResult => {
  const markers = input.sources.flatMap((file) =>
    extractSurfaceMarkersFromSource(file.path, file.source),
  );
  return mergeSurfaceInventoryYaml({
    existingYaml: input.existingYaml,
    markers,
    ...(input.locales === undefined ? {} : { locales: input.locales }),
    ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
  });
};
