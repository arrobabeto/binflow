import { createHash } from 'node:crypto';

import type { ProjectManifest, TextEditCandidate } from '@binflow/contracts';
import type {
  BlogFile,
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';
import { DomainError } from '@binflow/domain';

import {
  DEFAULT_SURFACE_INVENTORY_PATH,
  isShopifyTranslationKey,
  normalizeInventoryCopyText,
  parseSurfaceInventoryCopy,
  parseSurfaceInventoryStyleHints,
  parseSurfaceInventoryStyleTargets,
  pickInventoryCopyDisplayValue,
  resolveInventoryCopyCandidate,
  searchInventoryCopy,
  settingIdFromLocator,
  type SurfaceInventoryCopyRow,
  type SurfaceInventoryStyleHint,
  type SurfaceInventoryStyleTargetRow,
} from './surface-inventory-copy.js';

export type ThemeTextReadPort = Readonly<{
  /**
   * Optional tree listing. Enrichment indexes area-scoped templates first;
   * when this returns before those reads finish it may add extra paths.
   * Slow/hanging listings are ignored so Telegram collection cannot stall.
   */
  listFiles?(prefixes: readonly string[]): Promise<readonly string[]>;
  readFile(path: string): Promise<string | null>;
}>;

export type ThemeTextInventoryLoadResult = Readonly<{
  rows: readonly SurfaceInventoryCopyRow[];
  styleHints: readonly SurfaceInventoryStyleHint[];
}>;

const usefulCopy = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  return trimmed;
};

const SCHEMA_LOCALE_CANDIDATES = [
  'locales/en.default.schema.json',
  'locales/en.schema.json',
] as const;

/** Known Shopify template paths used when `listFiles` is unavailable. */
const FALLBACK_TEMPLATE_PATHS = Object.freeze([
  'templates/index.json',
  'templates/product.json',
  'templates/page.story.json',
  'templates/page.biophenols.json',
  'templates/page.about.json',
  'templates/page.sustainability.json',
  'templates/page.careers.json',
  'templates/page.contact.json',
  'templates/page.faqs.json',
  'templates/page.json',
  'templates/collection.json',
  'templates/list-collections.json',
  'templates/cart.json',
  'templates/search.json',
  'templates/blog.json',
  'templates/article.json',
  'templates/password.json',
  'templates/404.json',
]);

/** Primary template per inventory area — avoids blasting every FALLBACK path. */
const AREA_TEMPLATE_PATHS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    bio: Object.freeze(['templates/page.biophenols.json']),
    home: Object.freeze(['templates/index.json']),
    pdp: Object.freeze(['templates/product.json']),
    story: Object.freeze(['templates/page.story.json']),
  });

/** Areas that must survive enrich when present in inventory (not sample-only home). */
const NON_HOME_COVERAGE_AREAS = Object.freeze(['bio', 'pdp', 'story']);

const READ_CONCURRENCY = 5;

const sectionTypeFromPath = (path: string): string =>
  path
    .replace(/^\//, '')
    .replace(/^sections\//u, '')
    .replace(/\.liquid$/u, '')
    .trim();

const templatePathsForAreas = (
  areas: ReadonlySet<string>,
): readonly string[] => {
  const paths = new Set<string>();
  for (const area of areas) {
    const mapped = AREA_TEMPLATE_PATHS[area];
    if (mapped !== undefined) {
      for (const path of mapped) paths.add(path);
      continue;
    }
    // Unknown area: try page.<area>.json plus common FALLBACK pages.
    paths.add(`templates/page.${area}.json`);
    for (const fallback of FALLBACK_TEMPLATE_PATHS) paths.add(fallback);
  }
  return Object.freeze([...paths]);
};

const mapPool = async <T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const runners = Array.from({ length: limit }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
};

type TemplateSettingsIndex = Map<string, Map<string, string[]>>;

const pushIndexedSetting = (
  index: TemplateSettingsIndex,
  sectionType: string,
  settingId: string,
  value: string,
): void => {
  let bySetting = index.get(sectionType);
  if (bySetting === undefined) {
    bySetting = new Map();
    index.set(sectionType, bySetting);
  }
  const existing = bySetting.get(settingId) ?? [];
  if (existing.includes(value)) return;
  bySetting.set(settingId, [...existing, value]);
};

const ingestTemplateJson = (
  index: TemplateSettingsIndex,
  templateJson: unknown,
): void => {
  if (
    templateJson === null ||
    typeof templateJson !== 'object' ||
    Array.isArray(templateJson)
  )
    return;
  const sections = (templateJson as { sections?: unknown }).sections;
  if (
    sections === null ||
    typeof sections !== 'object' ||
    Array.isArray(sections)
  )
    return;
  for (const entry of Object.values(sections as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    const sectionType = usefulCopy(
      typeof record.type === 'string' ? record.type : undefined,
    );
    if (sectionType === undefined) continue;
    const settings = record.settings;
    if (
      settings === null ||
      typeof settings !== 'object' ||
      Array.isArray(settings)
    )
      continue;
    for (const [settingId, raw] of Object.entries(
      settings as Record<string, unknown>,
    )) {
      const value = usefulCopy(typeof raw === 'string' ? raw : undefined);
      if (value === undefined) continue;
      pushIndexedSetting(index, sectionType, settingId, value);
    }
  }
};

const resolveSchemaTranslationKey = async (
  readFile: (path: string) => Promise<string | null>,
  translationKey: string,
  localeCache: Map<string, Promise<unknown>>,
): Promise<string | undefined> => {
  if (!isShopifyTranslationKey(translationKey)) return undefined;
  const path = translationKey.trim().slice(2).trim();
  if (path.length === 0) return undefined;
  const parts = path.split('.').filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;

  for (const file of SCHEMA_LOCALE_CANDIDATES) {
    let pending = localeCache.get(file);
    if (pending === undefined) {
      pending = readFile(file).then((raw) => {
        if (raw === null || raw.trim().length === 0) return null;
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return null;
        }
      });
      localeCache.set(file, pending);
    }
    const document = await pending;
    if (document === null || typeof document !== 'object') continue;
    let cursor: unknown = document;
    for (const part of parts) {
      if (
        cursor === null ||
        typeof cursor !== 'object' ||
        Array.isArray(cursor)
      ) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    const resolved = usefulCopy(
      typeof cursor === 'string' ? cursor : undefined,
    );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
};

const isThemeTemplateJsonPath = (path: string): boolean =>
  path.startsWith('templates/') &&
  path.endsWith('.json') &&
  !path.includes('/customers/');

/** Recursive GitHub trees can hang; never block inventory search on them. */
const LIST_FILES_BUDGET_MS = 2_500;

const withBudget = async <T>(
  promise: Promise<T>,
  budgetMs: number,
): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), budgetMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const ingestTemplatePath = async (
  readCached: (path: string) => Promise<string | null>,
  templateIndex: TemplateSettingsIndex,
  templatePath: string,
): Promise<void> => {
  const raw = await readCached(templatePath);
  if (raw === null || raw.trim().length === 0) return;
  try {
    ingestTemplateJson(templateIndex, JSON.parse(raw) as unknown);
  } catch {
    // Skip invalid template JSON.
  }
};

const assertNonHomeEnrichmentCoverage = (
  sourceRows: readonly SurfaceInventoryCopyRow[],
  enriched: readonly SurfaceInventoryCopyRow[],
): void => {
  const sourceAreas = new Set(sourceRows.map((row) => row.area));
  const required = NON_HOME_COVERAGE_AREAS.filter((area) =>
    sourceAreas.has(area),
  );
  if (required.length === 0) return;
  const enrichedAreas = new Set(enriched.map((row) => row.area));
  const missing = required.filter((area) => !enrichedAreas.has(area));
  if (missing.length === 0) return;
  throw new DomainError(
    'validation_error',
    `Theme copy enrichment failed for area(s): ${missing.join(', ')}. Live Liquid/template reads returned no searchable text (inventory samples alone are not enough for non-home pages).`,
    {
      code: 'surface_inventory_enrichment_failed',
      missingAreas: missing.join(','),
    },
  );
};

/**
 * Resolve live schema default + theme template instance values onto each row.
 * Indexes area-scoped templates with bounded concurrency. Does not swallow
 * GitHub read errors (null = missing file only). Fails closed when inventory
 * declares story/bio/pdp copy but enrich keeps none of those areas.
 */
export const enrichInventoryCopyRows = async (
  reader: ThemeTextReadPort,
  rows: readonly SurfaceInventoryCopyRow[],
): Promise<readonly SurfaceInventoryCopyRow[]> => {
  const fileCache = new Map<string, Promise<string | null>>();
  const localeCache = new Map<string, Promise<unknown>>();
  const readCached = (rawPath: string): Promise<string | null> => {
    const path = rawPath.replace(/^\//, '').trim();
    const existing = fileCache.get(path);
    if (existing !== undefined) return existing;
    // Propagate non-404 errors — never coerce rate limits into "missing file".
    const pending = reader.readFile(path);
    fileCache.set(path, pending);
    return pending;
  };

  const areas = new Set(rows.map((row) => row.area));
  const primaryTemplates = templatePathsForAreas(areas);
  const liquidPaths = [
    ...new Set(
      rows
        .map((row) => row.path.replace(/^\//, '').trim())
        .filter((path) => path.length > 0),
    ),
  ];

  const listedPromise =
    reader.listFiles === undefined
      ? Promise.resolve(undefined)
      : withBudget(reader.listFiles(['templates/']), LIST_FILES_BUDGET_MS);

  const templateIndex: TemplateSettingsIndex = new Map();
  await mapPool(primaryTemplates, READ_CONCURRENCY, async (templatePath) => {
    await ingestTemplatePath(readCached, templateIndex, templatePath);
  });

  // Prefetch unique Liquid section files under the same concurrency budget.
  await mapPool(liquidPaths, READ_CONCURRENCY, async (path) => {
    await readCached(path);
  });

  const listedReady = await Promise.race([
    listedPromise.then((value) => ({ ready: true as const, value })),
    Promise.resolve({ ready: false as const, value: undefined }),
  ]);
  if (listedReady.ready && listedReady.value !== undefined) {
    const known = new Set(primaryTemplates);
    const extras = listedReady.value.filter(
      (path) => isThemeTemplateJsonPath(path) && !known.has(path),
    );
    if (extras.length > 0) {
      await mapPool(extras, READ_CONCURRENCY, async (templatePath) => {
        await ingestTemplatePath(readCached, templateIndex, templatePath);
      });
    }
  } else {
    void listedPromise;
  }

  const enriched: SurfaceInventoryCopyRow[] = [];
  for (const row of rows) {
    let liveDefault: string | undefined;
    let liveInstances: string[] = [];
    const settingId = settingIdFromLocator(row.locator);
    const source = await readCached(row.path);
    if (source !== null) {
      try {
        const fromSchema = usefulCopy(
          readLiquidSchemaDefault(source, settingId),
        );
        if (fromSchema !== undefined) {
          liveDefault = isShopifyTranslationKey(fromSchema)
            ? ((await resolveSchemaTranslationKey(
                readCached,
                fromSchema,
                localeCache,
              )) ?? fromSchema)
            : fromSchema;
        }
      } catch {
        // Keep sample / template instance when a single schema parse fails.
      }
    }
    const sectionType = sectionTypeFromPath(row.path);
    if (sectionType.length > 0) {
      liveInstances = [
        ...(templateIndex.get(sectionType)?.get(settingId) ?? []),
      ];
    }
    const sample = usefulCopy(row.sample);
    if (
      liveDefault === undefined &&
      liveInstances.length === 0 &&
      sample === undefined
    )
      continue;

    let liveInstance = liveInstances[0];
    if (liveInstances.length > 1) {
      const ranked = [...liveInstances].sort((a, b) => b.length - a.length);
      liveInstance = ranked[0];
    }

    enriched.push({
      ...row,
      ...(liveDefault === undefined ? {} : { liveDefault }),
      ...(liveInstance === undefined ? {} : { liveInstance }),
      ...(liveInstances.length === 0
        ? {}
        : { liveInstances: Object.freeze([...liveInstances]) }),
      ...(sample === undefined ? {} : { sample }),
    });
  }

  const frozen = Object.freeze(enriched);
  assertNonHomeEnrichmentCoverage(rows, frozen);
  return frozen;
};

/**
 * Resolve live Liquid/template text onto style_target rows so Telegram can
 * distinguish style-only headings even when inventory `sample` is empty.
 */
export const enrichInventoryStyleHints = async (
  reader: ThemeTextReadPort,
  targets: readonly SurfaceInventoryStyleTargetRow[],
): Promise<readonly SurfaceInventoryStyleHint[]> => {
  if (targets.length === 0) return Object.freeze([]);

  const fileCache = new Map<string, Promise<string | null>>();
  const localeCache = new Map<string, Promise<unknown>>();
  const readCached = (rawPath: string): Promise<string | null> => {
    const path = rawPath.replace(/^\//, '').trim();
    const existing = fileCache.get(path);
    if (existing !== undefined) return existing;
    const pending = reader.readFile(path);
    fileCache.set(path, pending);
    return pending;
  };

  const areas = new Set(targets.map((row) => row.area));
  const primaryTemplates = templatePathsForAreas(areas);
  const liquidPaths = [
    ...new Set(
      targets
        .map((row) => row.path.replace(/^\//, '').trim())
        .filter((path) => path.length > 0),
    ),
  ];

  const templateIndex: TemplateSettingsIndex = new Map();
  await mapPool(primaryTemplates, READ_CONCURRENCY, async (templatePath) => {
    await ingestTemplatePath(readCached, templateIndex, templatePath);
  });
  await mapPool(liquidPaths, READ_CONCURRENCY, async (path) => {
    await readCached(path);
  });

  const hints: SurfaceInventoryStyleHint[] = [];
  const seen = new Set<string>();
  for (const row of targets) {
    let liveDefault: string | undefined;
    let liveInstance: string | undefined;
    const settingId = settingIdFromLocator(row.locator);
    const source = await readCached(row.path);
    if (source !== null) {
      try {
        const fromSchema = usefulCopy(
          readLiquidSchemaDefault(source, settingId),
        );
        if (fromSchema !== undefined) {
          liveDefault = isShopifyTranslationKey(fromSchema)
            ? ((await resolveSchemaTranslationKey(
                readCached,
                fromSchema,
                localeCache,
              )) ?? fromSchema)
            : fromSchema;
        }
      } catch {
        // Prefer sample / template when schema parse fails.
      }
    }
    const sectionType = sectionTypeFromPath(row.path);
    if (sectionType.length > 0) {
      const instances = templateIndex.get(sectionType)?.get(settingId) ?? [];
      if (instances.length > 0) {
        liveInstance = [...instances].sort((a, b) => b.length - a.length)[0];
      }
    }
    const sample = usefulCopy(row.sample);
    const picked = pickInventoryCopyDisplayValue({
      ...(liveDefault === undefined ? {} : { liveDefault }),
      ...(liveInstance === undefined ? {} : { liveInstance }),
      ...(sample === undefined ? {} : { sample }),
    });
    if (picked === undefined) continue;
    const key = normalizeInventoryCopyText(picked);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    hints.push({ area: row.area, sample: picked });
  }
  return Object.freeze(hints);
};

export type ThemeTextPatchArtifact = Readonly<{
  candidate: TextEditCandidate;
  githubPath: string;
  newValue: string;
  previewRoute: string;
  settingId: string;
}>;

export type ThemeTextPreviewResult = Readonly<{
  patch: ThemeTextPatchArtifact;
  publication: DraftPublication;
}>;

export type ThemeTextPublishResult = Readonly<{
  mergeCommitSha: string;
  previewRoute: string;
  publication: DraftPublication;
  urls: Readonly<Record<string, string>>;
}>;

const SCHEMA_BLOCK =
  /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/iu;

/**
 * Patch the `"default"` of the settings entry whose `"id"` matches settingId
 * inside a Liquid `{% schema %}` JSON block. Fail-closed if not found.
 */
export const patchLiquidSchemaDefault = (
  liquidSource: string,
  settingId: string,
  newDefault: string,
): string => {
  const match = SCHEMA_BLOCK.exec(liquidSource);
  if (match === null || match.index === undefined)
    throw new DomainError(
      'validation_error',
      'Liquid file has no schema block.',
      { code: 'text_target_not_found' },
    );
  const schemaJson = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaJson);
  } catch {
    throw new DomainError(
      'validation_error',
      'Liquid schema JSON is invalid.',
      { code: 'text_target_not_found' },
    );
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  )
    throw new DomainError(
      'validation_error',
      'Liquid schema root must be an object.',
      { code: 'text_target_not_found' },
    );
  const settings = (parsed as { settings?: unknown }).settings;
  if (!Array.isArray(settings))
    throw new DomainError(
      'validation_error',
      'Liquid schema has no settings array.',
      { code: 'text_target_not_found' },
    );
  let found = false;
  for (const entry of settings) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      continue;
    const record = entry as Record<string, unknown>;
    if (record.id !== settingId) continue;
    record.default = newDefault;
    found = true;
    break;
  }
  if (!found)
    throw new DomainError(
      'validation_error',
      `Schema setting id "${settingId}" was not found.`,
      { code: 'text_target_not_found' },
    );
  const nextSchema = JSON.stringify(parsed, null, 2);
  const replacement = `{% schema %}\n${nextSchema}\n{% endschema %}`;
  return (
    liquidSource.slice(0, match.index) +
    replacement +
    liquidSource.slice(match.index + match[0].length)
  );
};

/** Read current schema default for a setting id, if present. */
export const readLiquidSchemaDefault = (
  liquidSource: string,
  settingId: string,
): string | undefined => {
  const match = SCHEMA_BLOCK.exec(liquidSource);
  if (match === null) return undefined;
  try {
    const parsed = JSON.parse(match[1] ?? '') as {
      settings?: ReadonlyArray<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.settings)) return undefined;
    for (const entry of parsed.settings) {
      if (entry?.id !== settingId) continue;
      return typeof entry.default === 'string' ? entry.default : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

export class EditThemeTextExecutor {
  public constructor(
    private readonly repository: RepositoryPublicationPort,
    private readonly reader: ThemeTextReadPort,
  ) {}

  public async loadInventory(
    inventoryPath: string = DEFAULT_SURFACE_INVENTORY_PATH,
  ): Promise<ThemeTextInventoryLoadResult> {
    const raw = await this.reader.readFile(inventoryPath);
    if (raw === null || raw.trim().length === 0)
      throw new DomainError(
        'validation_error',
        'Surface inventory is missing; copy allowlist is empty.',
        { code: 'surface_inventory_missing' },
      );
    const rows = parseSurfaceInventoryCopy(raw);
    if (rows.length === 0)
      throw new DomainError(
        'validation_error',
        'Surface inventory has no github_theme copy rows.',
        { code: 'surface_inventory_empty' },
      );
    const enriched = await enrichInventoryCopyRows(this.reader, rows);
    if (enriched.length === 0)
      throw new DomainError(
        'validation_error',
        'Surface inventory copy rows have no readable schema default or sample text.',
        { code: 'surface_inventory_empty' },
      );
    const styleHints = await enrichInventoryStyleHints(
      this.reader,
      parseSurfaceInventoryStyleTargets(raw),
    );
    return Object.freeze({
      rows: enriched,
      styleHints:
        styleHints.length > 0
          ? styleHints
          : parseSurfaceInventoryStyleHints(raw),
    });
  }

  public search(
    rows: readonly SurfaceInventoryCopyRow[],
    query: string,
  ): readonly TextEditCandidate[] {
    return searchInventoryCopy(rows, query);
  }

  public resolve(
    rows: readonly SurfaceInventoryCopyRow[],
    key: string,
    currentValue?: string,
  ): TextEditCandidate {
    return resolveInventoryCopyCandidate(rows, key, currentValue);
  }

  public async readCurrentValue(
    row: SurfaceInventoryCopyRow,
  ): Promise<string | undefined> {
    const settingId = settingIdFromLocator(row.locator);
    const path = row.path.replace(/^\//, '').trim();
    const source = await this.reader.readFile(path);
    let liveDefault: string | undefined;
    if (source !== null) {
      const fromSchema = readLiquidSchemaDefault(source, settingId);
      if (fromSchema !== undefined && fromSchema.trim().length > 0)
        liveDefault = fromSchema.trim();
    }
    return pickInventoryCopyDisplayValue({
      ...(liveDefault === undefined ? {} : { liveDefault }),
      ...(row.liveInstance === undefined ? {} : { liveInstance: row.liveInstance }),
      ...(row.sample === undefined ? {} : { sample: row.sample }),
    });
  }

  public async preparePreview(input: Readonly<{
    candidate: TextEditCandidate;
    inventoryRow: SurfaceInventoryCopyRow;
    manifest: ProjectManifest;
    newValue: string;
    onStage?: (node: string) => Promise<void> | void;
    requestId: string;
  }>): Promise<ThemeTextPreviewResult> {
    await input.onStage?.('sync_inventory_copy');
    await input.onStage?.('validate_text_edit');
    const newValue = input.newValue.trim();
    if (newValue.length === 0)
      throw new DomainError(
        'validation_error',
        'Replacement text cannot be empty.',
        { code: 'text_replacement_missing' },
      );

    const settingId = settingIdFromLocator(input.inventoryRow.locator);
    const githubPath = input.inventoryRow.path.replace(/^\//, '').trim();
    const source = await this.reader.readFile(githubPath);
    if (source === null)
      throw new DomainError(
        'validation_error',
        `Theme Liquid file missing: ${githubPath}`,
        { code: 'text_target_not_found' },
      );

    await input.onStage?.('render_theme_text_patch');
    const patched = patchLiquidSchemaDefault(source, settingId, newValue);
    const bytes = new TextEncoder().encode(patched);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const files: BlogFile[] = [
      {
        bytes,
        mime: 'text/plain',
        path: githubPath,
        sha256,
      },
    ];

    await input.onStage?.('open_text_edit_pr');
    const branch = input.manifest.repository.branchPattern
      .replaceAll('{capability}', 'edit-text-shopify')
      .replaceAll('{projectKey}', input.manifest.repository.name)
      .replaceAll('{request-id}', input.requestId)
      .replaceAll('{slug}', input.candidate.key.replaceAll('.', '-'));
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: input.candidate.key.replaceAll('.', '-'),
    });
    if (publication.headCommitSha.length < 7)
      throw new DomainError(
        'provider_final',
        'Theme text PR could not be opened.',
        { code: 'github_pr_failed' },
      );

    await input.onStage?.('record_theme_preview');
    return {
      patch: {
        candidate: {
          ...input.candidate,
          currentValue: newValue,
        },
        githubPath,
        newValue,
        previewRoute: '/',
        settingId,
      },
      publication,
    };
  }

  public async publish(input: Readonly<{
    onStage?: (node: string) => Promise<void> | void;
    productionOrigin: string;
    publication: DraftPublication;
  }>): Promise<ThemeTextPublishResult> {
    await input.onStage?.('merge_github');
    await this.repository.revalidate({
      expectedFiles: [...input.publication.files],
      expectedHeadSha: input.publication.headCommitSha,
      pullRequestId: input.publication.pullRequestId,
      requireCommitStatus: false,
    });
    const merge = await this.repository.merge({
      expectedHeadSha: input.publication.headCommitSha,
      pullRequestId: input.publication.pullRequestId,
    });
    await input.onStage?.('verify_production');
    return {
      mergeCommitSha: merge.mergeCommitSha,
      previewRoute: '/',
      publication: input.publication,
      urls: {
        production: input.productionOrigin,
        pullRequest: input.publication.pullRequestUrl,
      },
    };
  }
}
