import { v7 as uuidv7 } from 'uuid';

import {
  editImageInputSchema,
  type CapabilityInput,
  type EditImageInput,
  type ImageEditCandidate,
  type ProjectManifest,
  type SupportedLocale,
  type TelegramReply,
} from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import {
  DEFAULT_SURFACE_INVENTORY_PATH,
  inventoryImagesForArea,
  listInventoryImageAreas,
  parseSurfaceInventoryImages,
  resolveInventoryImageCandidate,
  searchInventoryImages,
  type SurfaceInventoryImageRow,
  type ThemeImageReadPort,
} from '@binflow/images';
import { editImageShopifyDefinition } from '@binflow/policies';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  buildEditImageDisambiguationMessage,
  buildEditImagePickActionRows,
  buildEditImagePlanMessage,
  buildEditImageTargetConfirmMessage,
  editImageActionLabels,
  editImageBrowsePageEmptyMessage,
  editImageBrowsePagesMessage,
  editImageDeepSearchEmptyInventoryMessage,
  editImageDeepSearchFailedMessage,
  editImageEmptyReplacementMessage,
  editImageGuidance,
  editImageInvalidReplacementMessage,
  editImageReplacementPrompt,
  editImageTargetNotFoundMessage,
  formatEditImagePageLabel,
  formatEditImagePickLabel,
  parseEditImageExecuteInput,
} from './edit-image-ingress.js';
import type { PersistReplacementImage } from './edit-image-collection.js';

export type ThemeImageInventoryLoader = (input: Readonly<{
  database: ScopedDatabase;
  manifest: ProjectManifest;
  projectId: string;
  tenantId: string;
}>) => Promise<readonly SurfaceInventoryImageRow[]>;

export type ThemeInventoryRemapRunner = (input: Readonly<{
  autoMerge: boolean;
  database: ScopedDatabase;
  manifest: ProjectManifest;
  projectId: string;
  requestId: string;
  tenantId: string;
}>) => Promise<
  Readonly<{
    changed: boolean;
    imageRows: readonly SurfaceInventoryImageRow[];
    pullRequestUrl?: string;
  }>
>;

/** Resolve a Telegram-fetchable URL for the current theme inventory asset. */
export type ThemeAssetPreviewUrlResolver = (input: Readonly<{
  assetPath: string;
  manifest: ProjectManifest;
}>) => Promise<string | undefined>;

type ResolvedIdentity = Readonly<{
  clientActorRole: 'owner' | 'piloter';
  conversationId: string;
  enrollmentId: string;
  locale: SupportedLocale;
  projectId: string;
  tenantId: string;
  userId: string;
}>;

type ReplyFn = (
  locale: SupportedLocale,
  text: string,
  requestId: string | null,
  actionTokens?: TelegramReply['actionTokens'],
  extras?: Readonly<{
    actionRows?: TelegramReply['actionRows'];
    photoUrl?: string;
  }>,
) => TelegramReply;

type CreateActionFn = (
  database: ScopedDatabase,
  request: Pick<
    typeof schema.requests.$inferSelect,
    'id' | 'projectId' | 'tenantId'
  >,
  requestVersionId: string,
  userId: string,
  action: string,
) => Promise<string>;

type HasCapabilityFn = (
  database: ScopedDatabase,
  projectId: string,
  capabilityId: string,
) => Promise<boolean>;

type EditImageCollectInput = Extract<EditImageInput, { mode: 'collect' }>;

const MAX_REPLACEMENT_BYTES = 8_000_000;
const ALLOWED_REPLACEMENT_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const parseEditImageCollect = (value: unknown): EditImageCollectInput => {
  const parsed = editImageInputSchema.parse(value);
  if (parsed.mode !== 'collect')
    throw new Error('Expected edit_image_shopify collect input.');
  return parsed;
};

const persistCollectionVersion = async (input: Readonly<{
  database: ScopedDatabase;
  interpretedInput: EditImageCollectInput;
  plan: Record<string, unknown>;
  projectId: string;
  request: typeof schema.requests.$inferSelect;
  tenantId: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<string> => {
  const nextVersion = input.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  await input.database
    .update(schema.requests)
    .set({ currentVersion: nextVersion, state: 'NEEDS_INPUT' })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editImageShopifyDefinition.version,
    id: requestVersionId,
    interpretedInput: input.interpretedInput as CapabilityInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: input.plan,
    projectId: input.projectId,
    requestId: input.request.id,
    tenantId: input.tenantId,
    version: nextVersion,
  });
  return requestVersionId;
};

const mimeFromArtifactKey = (key: string): string => {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
};

const normalizeMime = (mime: string): string => {
  const lower = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (lower === 'image/jpg') return 'image/jpeg';
  return lower;
};

const BLOCKED_REPLACEMENT_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
]);

const isBlockedReplacementHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (BLOCKED_REPLACEMENT_HOSTS.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  const ipv4 =
    /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/u;
  return ipv4.test(host);
};

const isHttpsImageUrl = (text: string): boolean => {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    if (isBlockedReplacementHostname(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
};

const fetchReplacementFromUrl = async (
  url: string,
  persist: PersistReplacementImage,
): Promise<Readonly<{ artifactKey: string; mime: string; sourceUrl: string }>> => {
  if (!isHttpsImageUrl(url))
    throw new DomainError(
      'validation_error',
      'Replacement image URL is not allowed.',
      { code: 'image_replacement_invalid' },
    );
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new DomainError(
      'validation_error',
      'Replacement image URL could not be fetched.',
      { code: 'image_replacement_invalid' },
    );
  }
  if (!response.ok)
    throw new DomainError(
      'validation_error',
      'Replacement image URL returned an error.',
      { code: 'image_replacement_invalid' },
    );
  const mime = normalizeMime(
    response.headers.get('content-type') ?? 'application/octet-stream',
  );
  if (!ALLOWED_REPLACEMENT_MIMES.has(mime))
    throw new DomainError(
      'validation_error',
      'Replacement image must be JPEG, PNG, or WebP.',
      { code: 'image_replacement_invalid' },
    );
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_REPLACEMENT_BYTES)
    throw new DomainError(
      'validation_error',
      'Replacement image exceeds the allowed size.',
      { code: 'image_replacement_invalid' },
    );
  const artifactKey = await persist({ bytes: buffer, mime });
  return { artifactKey, mime, sourceUrl: url };
};

const targetConfirmActions = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => [
  {
    action: 'confirm_image_target',
    label: editImageActionLabels[input.identity.locale].confirmTarget,
    token: await input.createAction(
      input.database,
      input.request,
      input.requestVersionId,
      input.identity.userId,
      'confirm_image_target',
    ),
  },
  {
    action: 'reject_image_target',
    label: editImageActionLabels[input.identity.locale].rejectTarget,
    token: await input.createAction(
      input.database,
      input.request,
      input.requestVersionId,
      input.identity.userId,
      'reject_image_target',
    ),
  },
];

/**
 * Prefer live CDN / GitHub raw preview URL for confirm UI.
 * Sync stub kept for tests; production wires `resolveThemeAssetPreviewUrl`.
 */
export const shopifyThemeImageConfirmPhotoUrl = (
  _manifest: ProjectManifest,
  _candidate: ImageEditCandidate,
): string | undefined => undefined;

const loadInventoryRows = async (input: Readonly<{
  database: ScopedDatabase;
  loadInventory: ThemeImageInventoryLoader;
  manifest: ProjectManifest;
  projectId: string;
  tenantId: string;
}>): Promise<readonly SurfaceInventoryImageRow[]> =>
  input.loadInventory({
    database: input.database,
    manifest: input.manifest,
    projectId: input.projectId,
    tenantId: input.tenantId,
  });

const resolveTarget = (
  rows: readonly SurfaceInventoryImageRow[],
  key: string,
): ImageEditCandidate | null => {
  try {
    return resolveInventoryImageCandidate(rows, key);
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.metadata.code === 'image_target_not_found'
    )
      return null;
    throw error;
  }
};

export const createEditImageShopifyRequest = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  hasCapability: HasCapabilityFn;
  identity: ResolvedIdentity;
  initialQuery?: string;
  loadInventory?: ThemeImageInventoryLoader;
  reply: ReplyFn;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
}>): Promise<TelegramReply> => {
  if (
    !(await input.hasCapability(
      input.database,
      input.identity.projectId,
      'edit_image_shopify',
    ))
  )
    return input.reply(
      input.identity.locale,
      editImageGuidance[input.identity.locale],
      null,
    );

  const [manifestRow] = await input.database
    .select({
      document: schema.projectManifestVersions.document,
      id: schema.projectManifestVersions.id,
    })
    .from(schema.projectManifestVersions)
    .where(
      and(
        eq(schema.projectManifestVersions.projectId, input.identity.projectId),
        inArray(schema.projectManifestVersions.status, ['validated', 'active']),
      ),
    )
    .orderBy(desc(schema.projectManifestVersions.version))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(
      input.identity.locale,
      editImageGuidance[input.identity.locale],
      null,
    );

  const requestId = uuidv7();
  const requestVersionId = uuidv7();
  const interpretedInput = parseEditImageCollect({
    collectionStep: 'await_target',
    mode: 'collect',
    projectId: input.identity.projectId,
  });
  await input.database.insert(schema.requests).values({
    capabilityId: 'edit_image_shopify',
    clientActorRole: input.identity.clientActorRole,
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT',
    tenantId: input.identity.tenantId,
    topic: 'Theme image edit',
    userId: input.identity.userId,
  });
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editImageShopifyDefinition.version,
    id: requestVersionId,
    interpretedInput,
    manifestVersionId: manifestRow.id,
    plan: { collectionStep: 'await_target', nodes: ['await_target'] },
    projectId: input.identity.projectId,
    requestId,
    tenantId: input.identity.tenantId,
    version: 1,
  });

  const initialQuery = input.initialQuery?.trim() ?? '';
  if (initialQuery.length > 0 && input.loadInventory !== undefined) {
    const [fullRequest] = await input.database
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);
    const [version] = await input.database
      .select()
      .from(schema.requestVersions)
      .where(eq(schema.requestVersions.id, requestVersionId))
      .limit(1);
    if (fullRequest !== undefined && version !== undefined) {
      return continueEditImageShopifyCollection({
        createAction: input.createAction,
        database: input.database,
        identity: input.identity,
        loadInventory: input.loadInventory,
        reply: input.reply,
        request: fullRequest,
        text: initialQuery,
        version,
        ...(input.resolvePreviewUrl === undefined
          ? {}
          : { resolvePreviewUrl: input.resolvePreviewUrl }),
      });
    }
  }

  return input.reply(
    input.identity.locale,
    editImageGuidance[input.identity.locale],
    requestId,
  );
};

const pickTargetTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  matches: readonly ImageEditCandidate[];
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const actionTokens: TelegramReply['actionTokens'] = [];
  for (const [index, candidate] of input.matches.slice(0, 8).entries()) {
    actionTokens.push({
      action: 'pick_image_target',
      label: formatEditImagePickLabel(
        input.identity.locale,
        index,
        candidate,
      ),
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        `pick_image_target:${candidate.key}`,
      ),
    });
  }
  return actionTokens;
};

const MAX_BROWSE_PAGE_BUTTONS = 20;

const presentBrowsePages = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  pendingSearchQuery?: string;
  previous: EditImageCollectInput;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  rows: readonly SurfaceInventoryImageRow[];
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const areas = listInventoryImageAreas(input.rows).slice(
    0,
    MAX_BROWSE_PAGE_BUTTONS,
  );
  const offerDeepSearch = input.previous.deepSearchAttempted !== true;
  if (areas.length === 0 && !offerDeepSearch)
    return input.reply(
      input.identity.locale,
      editImageTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  const interpretedInput = parseEditImageCollect({
    ...input.previous,
    browseArea: undefined,
    collectionStep: 'browse_pages',
    discoveredTargets: [],
    ...(input.pendingSearchQuery === undefined
      ? {}
      : { pendingSearchQuery: input.pendingSearchQuery }),
  });
  const requestVersionId = await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: { collectionStep: 'browse_pages', nodes: ['browse_pages'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  const actionTokens: TelegramReply['actionTokens'] = [];
  for (const area of areas) {
    actionTokens.push({
      action: 'pick_image_page',
      label: formatEditImagePageLabel(input.identity.locale, area),
      token: await input.createAction(
        input.database,
        input.request,
        requestVersionId,
        input.identity.userId,
        `pick_image_page:${area}`,
      ),
    });
  }
  if (offerDeepSearch) {
    actionTokens.push({
      action: 'deep_search_inventory',
      label: editImageActionLabels[input.identity.locale].deepSearch,
      token: await input.createAction(
        input.database,
        input.request,
        requestVersionId,
        input.identity.userId,
        'deep_search_inventory',
      ),
    });
  }
  actionTokens.push({
    action: 'cancel_image_browse',
    label: editImageActionLabels[input.identity.locale].cancel,
    token: await input.createAction(
      input.database,
      input.request,
      requestVersionId,
      input.identity.userId,
      'cancel_image_browse',
    ),
  });
  const message =
    areas.length === 0
      ? editImageDeepSearchEmptyInventoryMessage[input.identity.locale]
      : editImageBrowsePagesMessage[input.identity.locale];
  return input.reply(
    input.identity.locale,
    message,
    input.request.id,
    actionTokens,
    { actionRows: buildEditImagePickActionRows(actionTokens) },
  );
};

const presentAreaImages = async (input: Readonly<{
  area: string;
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  manifest: ProjectManifest;
  previous: EditImageCollectInput;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
  rows: readonly SurfaceInventoryImageRow[];
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const matches = inventoryImagesForArea(input.rows, input.area);
  if (matches.length === 0) {
    return presentBrowsePages({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      previous: input.previous,
      reply: (locale, text, requestId, actionTokens, extras) =>
        input.reply(
          locale,
          editImageBrowsePageEmptyMessage[locale],
          requestId,
          actionTokens,
          extras,
        ),
      request: input.request,
      rows: input.rows,
      version: input.version,
    });
  }
  if (matches.length === 1) {
    const target = matches[0]!;
    return advanceToConfirmTarget({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      manifest: input.manifest,
      previous: parseEditImageCollect({
        ...input.previous,
        browseArea: input.area,
        discoveredTargets: matches,
      }),
      reply: input.reply,
      request: input.request,
      target,
      version: input.version,
      ...(input.resolvePreviewUrl === undefined
        ? {}
        : { resolvePreviewUrl: input.resolvePreviewUrl }),
    });
  }
  const interpretedInput = parseEditImageCollect({
    ...input.previous,
    browseArea: input.area,
    collectionStep: 'disambiguate',
    discoveredTargets: matches,
  });
  const requestVersionId = await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: { collectionStep: 'disambiguate', nodes: ['disambiguate'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  const actionTokens = await pickTargetTokens({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    matches,
    request: input.request,
    requestVersionId,
  });
  return input.reply(
    input.identity.locale,
    buildEditImageDisambiguationMessage(input.identity.locale, matches),
    input.request.id,
    actionTokens,
    { actionRows: buildEditImagePickActionRows(actionTokens) },
  );
};

const advanceToConfirmTarget = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  manifest: ProjectManifest;
  previous: EditImageCollectInput;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
  target: ImageEditCandidate;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const interpretedInput = parseEditImageCollect({
    ...input.previous,
    collectionStep: 'confirm_target',
    discoveredTargets: input.previous.discoveredTargets.some(
      (entry) => entry.key === input.target.key,
    )
      ? input.previous.discoveredTargets
      : [...input.previous.discoveredTargets, input.target],
    targetKey: input.target.key,
  });
  const requestVersionId = await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: { collectionStep: 'confirm_target', nodes: ['confirm_target'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  const actionTokens = await targetConfirmActions({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    request: input.request,
    requestVersionId,
  });
  let photoUrl: string | undefined;
  if (input.resolvePreviewUrl !== undefined) {
    try {
      photoUrl = await input.resolvePreviewUrl({
        assetPath: input.target.currentPath,
        manifest: input.manifest,
      });
    } catch {
      photoUrl = undefined;
    }
  }
  if (photoUrl === undefined)
    photoUrl = shopifyThemeImageConfirmPhotoUrl(input.manifest, input.target);
  return input.reply(
    input.identity.locale,
    buildEditImageTargetConfirmMessage(
      input.identity.locale,
      input.target,
      photoUrl,
    ),
    input.request.id,
    actionTokens,
    photoUrl === undefined ? undefined : { photoUrl },
  );
};

export const continueEditImageShopifyCollection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadInventory: ThemeImageInventoryLoader;
  persistReplacementImage?: PersistReplacementImage;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
  text: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseEditImageCollect(input.version.interpretedInput);
  if (previous.mode !== 'collect')
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  const [manifestRow] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  if (previous.collectionStep === 'await_target') {
    const query = input.text.trim();
    if (query.length === 0)
      return input.reply(
        input.identity.locale,
        editImageGuidance[input.identity.locale],
        input.request.id,
      );
    const rows = await loadInventoryRows({
      database: input.database,
      loadInventory: input.loadInventory,
      manifest: manifestRow.document,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    });
    const matches = searchInventoryImages(rows, query);
    if (matches.length === 0)
      return presentBrowsePages({
        createAction: input.createAction,
        database: input.database,
        identity: input.identity,
        pendingSearchQuery: query,
        previous,
        reply: input.reply,
        request: input.request,
        rows,
        version: input.version,
      });
    if (matches.length === 1) {
      const target = matches[0]!;
      return advanceToConfirmTarget({
        createAction: input.createAction,
        database: input.database,
        identity: input.identity,
        manifest: manifestRow.document,
        previous: parseEditImageCollect({
          ...previous,
          discoveredTargets: matches,
        }),
        reply: input.reply,
        request: input.request,
        target,
        version: input.version,
        ...(input.resolvePreviewUrl === undefined
          ? {}
          : { resolvePreviewUrl: input.resolvePreviewUrl }),
      });
    }
    const interpretedInput = parseEditImageCollect({
      ...previous,
      collectionStep: 'disambiguate',
      discoveredTargets: matches,
    });
    const requestVersionId = await persistCollectionVersion({
      database: input.database,
      interpretedInput,
      plan: { collectionStep: 'disambiguate', nodes: ['disambiguate'] },
      projectId: input.identity.projectId,
      request: input.request,
      tenantId: input.identity.tenantId,
      version: input.version,
    });
    const actionTokens = await pickTargetTokens({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      matches,
      request: input.request,
      requestVersionId,
    });
    return input.reply(
      input.identity.locale,
      buildEditImageDisambiguationMessage(input.identity.locale, matches),
      input.request.id,
      actionTokens,
      { actionRows: buildEditImagePickActionRows(actionTokens) },
    );
  }

  if (previous.collectionStep === 'browse_pages') {
    const rows = await loadInventoryRows({
      database: input.database,
      loadInventory: input.loadInventory,
      manifest: manifestRow.document,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    });
    return presentBrowsePages({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      previous,
      reply: input.reply,
      request: input.request,
      rows,
      version: input.version,
    });
  }

  if (previous.collectionStep === 'await_replacement') {
    const trimmed = input.text.trim();
    if (!isHttpsImageUrl(trimmed))
      return input.reply(
        input.identity.locale,
        editImageEmptyReplacementMessage[input.identity.locale],
        input.request.id,
      );
    if (input.persistReplacementImage === undefined)
      return input.reply(
        input.identity.locale,
        editImageReplacementPrompt[input.identity.locale],
        input.request.id,
      );
    let stored: Readonly<{
      artifactKey: string;
      mime: string;
      sourceUrl: string;
    }>;
    try {
      stored = await fetchReplacementFromUrl(
        trimmed,
        input.persistReplacementImage,
      );
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.metadata.code === 'image_replacement_invalid'
      )
        return input.reply(
          input.identity.locale,
          editImageInvalidReplacementMessage[input.identity.locale],
          input.request.id,
        );
      throw error;
    }
    return finishReplacementPlan({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      loadInventory: input.loadInventory,
      manifest: manifestRow.document,
      previous,
      reply: input.reply,
      replacementArtifactKey: stored.artifactKey,
      replacementMime: stored.mime,
      replacementSourceUrl: stored.sourceUrl,
      request: input.request,
      version: input.version,
    });
  }

  return input.reply(
    input.identity.locale,
    previous.collectionStep === 'confirm_target'
      ? editImageReplacementPrompt[input.identity.locale]
      : editImageGuidance[input.identity.locale],
    input.request.id,
  );
};

export const continueEditImageShopifyCollectionWithAttachment = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  imageArtifactKey: string;
  imageMime?: string;
  loadInventory: ThemeImageInventoryLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseEditImageCollect(input.version.interpretedInput);
  if (previous.mode !== 'collect' || previous.collectionStep !== 'await_replacement')
    return input.reply(
      input.identity.locale,
      editImageGuidance[input.identity.locale],
      input.request.id,
    );

  const [manifestRow] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  const mime = normalizeMime(
    input.imageMime ?? mimeFromArtifactKey(input.imageArtifactKey),
  );
  if (!ALLOWED_REPLACEMENT_MIMES.has(mime))
    return input.reply(
      input.identity.locale,
      editImageInvalidReplacementMessage[input.identity.locale],
      input.request.id,
    );

  return finishReplacementPlan({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    loadInventory: input.loadInventory,
    manifest: manifestRow.document,
    previous,
    reply: input.reply,
    replacementArtifactKey: input.imageArtifactKey,
    replacementMime: mime,
    request: input.request,
    version: input.version,
  });
};

const finishReplacementPlan = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadInventory: ThemeImageInventoryLoader;
  manifest: ProjectManifest;
  previous: EditImageCollectInput;
  reply: ReplyFn;
  replacementArtifactKey: string;
  replacementMime: string;
  replacementSourceUrl?: string;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const rows = await loadInventoryRows({
    database: input.database,
    loadInventory: input.loadInventory,
    manifest: input.manifest,
    projectId: input.identity.projectId,
    tenantId: input.identity.tenantId,
  });
  const target =
    input.previous.targetKey === undefined
      ? null
      : resolveTarget(rows, input.previous.targetKey);
  if (target === null)
    return input.reply(
      input.identity.locale,
      editImageTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  const interpretedInput = parseEditImageCollect({
    ...input.previous,
    collectionComplete: true,
    collectionStep: 'ready',
    replacementArtifactKey: input.replacementArtifactKey,
    replacementMime: input.replacementMime,
    ...(input.replacementSourceUrl === undefined
      ? {}
      : { replacementSourceUrl: input.replacementSourceUrl }),
  });
  const requestVersionId = await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: { collectionStep: 'ready', nodes: ['plan_confirm'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  const actionTokens: TelegramReply['actionTokens'] = [
    {
      action: 'confirm_image_plan',
      label: editImageActionLabels[input.identity.locale].confirmPlan,
      token: await input.createAction(
        input.database,
        input.request,
        requestVersionId,
        input.identity.userId,
        'confirm_image_plan',
      ),
    },
  ];
  return input.reply(
    input.identity.locale,
    buildEditImagePlanMessage(
      input.identity.locale,
      target,
      input.manifest.contentLocales,
    ),
    input.request.id,
    actionTokens,
  );
};

export const consumeEditImageShopifyPagePick = async (input: Readonly<{
  area: string;
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadInventory: ThemeImageInventoryLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'browse_pages')
    throw new Error(
      'Edit theme image page pick is invalid for this request state.',
    );
  const [manifestRow] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);
  const rows = await loadInventoryRows({
    database: input.database,
    loadInventory: input.loadInventory,
    manifest: manifestRow.document,
    projectId: input.identity.projectId,
    tenantId: input.identity.tenantId,
  });
  return presentAreaImages({
    area: input.area,
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    manifest: manifestRow.document,
    previous: parsed,
    reply: input.reply,
    request: input.request,
    rows,
    version: input.version,
    ...(input.resolvePreviewUrl === undefined
      ? {}
      : { resolvePreviewUrl: input.resolvePreviewUrl }),
  });
};

export const consumeEditImageShopifyBrowseCancel = async (input: Readonly<{
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'browse_pages')
    throw new Error(
      'Edit theme image browse cancel is invalid for this request state.',
    );
  const interpretedInput = parseEditImageCollect({
    ...parsed,
    browseArea: undefined,
    collectionStep: 'await_target',
    discoveredTargets: [],
    pendingSearchQuery: undefined,
  });
  await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: { collectionStep: 'await_target', nodes: ['await_target'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  return input.reply(
    input.identity.locale,
    editImageGuidance[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditImageShopifyDeepSearch = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadInventory: ThemeImageInventoryLoader;
  remapInventory: ThemeInventoryRemapRunner;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'browse_pages')
    throw new Error(
      'Edit theme image deep search is invalid for this request state.',
    );
  if (parsed.deepSearchAttempted === true)
    return input.reply(
      input.identity.locale,
      editImageTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );

  const [manifestRow] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  let rows: readonly SurfaceInventoryImageRow[];
  try {
    const remapped = await input.remapInventory({
      autoMerge: true,
      database: input.database,
      manifest: manifestRow.document,
      projectId: input.identity.projectId,
      requestId: input.request.id,
      tenantId: input.identity.tenantId,
    });
    rows =
      remapped.imageRows.length > 0
        ? remapped.imageRows
        : await loadInventoryRows({
            database: input.database,
            loadInventory: input.loadInventory,
            manifest: manifestRow.document,
            projectId: input.identity.projectId,
            tenantId: input.identity.tenantId,
          });
  } catch {
    const failed = parseEditImageCollect({
      ...parsed,
      deepSearchAttempted: true,
    });
    await persistCollectionVersion({
      database: input.database,
      interpretedInput: failed,
      plan: { collectionStep: 'browse_pages', nodes: ['remap_surface_inventory'] },
      projectId: input.identity.projectId,
      request: input.request,
      tenantId: input.identity.tenantId,
      version: input.version,
    });
    return input.reply(
      input.identity.locale,
      editImageDeepSearchFailedMessage[input.identity.locale],
      input.request.id,
    );
  }

  const marked = parseEditImageCollect({
    ...parsed,
    deepSearchAttempted: true,
  });
  const query = marked.pendingSearchQuery?.trim() ?? '';
  if (query.length === 0) {
    return presentBrowsePages({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      previous: marked,
      reply: input.reply,
      request: input.request,
      rows,
      version: input.version,
    });
  }

  const matches = searchInventoryImages(rows, query);
  if (matches.length === 0)
    return presentBrowsePages({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      pendingSearchQuery: query,
      previous: marked,
      reply: input.reply,
      request: input.request,
      rows,
      version: input.version,
    });
  if (matches.length === 1) {
    const target = matches[0]!;
    return advanceToConfirmTarget({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      manifest: manifestRow.document,
      previous: parseEditImageCollect({
        ...marked,
        discoveredTargets: matches,
      }),
      reply: input.reply,
      request: input.request,
      target,
      version: input.version,
      ...(input.resolvePreviewUrl === undefined
        ? {}
        : { resolvePreviewUrl: input.resolvePreviewUrl }),
    });
  }
  const interpretedInput = parseEditImageCollect({
    ...marked,
    collectionStep: 'disambiguate',
    discoveredTargets: matches,
  });
  const requestVersionId = await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: {
      collectionStep: 'disambiguate',
      nodes: ['remap_surface_inventory', 'disambiguate'],
    },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  const actionTokens = await pickTargetTokens({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    matches,
    request: input.request,
    requestVersionId,
  });
  return input.reply(
    input.identity.locale,
    buildEditImageDisambiguationMessage(input.identity.locale, matches),
    input.request.id,
    actionTokens,
    { actionRows: buildEditImagePickActionRows(actionTokens) },
  );
};

export const consumeEditImageShopifyTargetPick = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  resolvePreviewUrl?: ThemeAssetPreviewUrlResolver;
  targetKey: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (
    parsed.mode !== 'collect' ||
    (parsed.collectionStep !== 'disambiguate' &&
      parsed.collectionStep !== 'await_target')
  )
    throw new Error(
      'Edit theme image target pick is invalid for this request state.',
    );
  const target = parsed.discoveredTargets.find(
    (candidate) => candidate.key === input.targetKey,
  );
  if (target === undefined)
    return input.reply(
      input.identity.locale,
      editImageTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  const [manifestRow] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);
  return advanceToConfirmTarget({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    manifest: manifestRow.document,
    previous: parsed,
    reply: input.reply,
    request: input.request,
    target,
    version: input.version,
    ...(input.resolvePreviewUrl === undefined
      ? {}
      : { resolvePreviewUrl: input.resolvePreviewUrl }),
  });
};

export const consumeEditImageShopifyTargetConfirm = async (input: Readonly<{
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'confirm_target')
    throw new Error(
      'Edit theme image target confirm is invalid for this request state.',
    );
  const interpretedInput = parseEditImageCollect({
    ...parsed,
    collectionStep: 'await_replacement',
  });
  await persistCollectionVersion({
    database: input.database,
    interpretedInput,
    plan: { collectionStep: 'await_replacement', nodes: ['await_replacement'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  return input.reply(
    input.identity.locale,
    editImageReplacementPrompt[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditImageShopifyTargetReject = async (input: Readonly<{
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'confirm_target')
    throw new Error(
      'Edit theme image target reject is invalid for this request state.',
    );
  const cleaned = parseEditImageCollect({
    collectionComplete: false,
    collectionStep: 'await_target',
    discoveredTargets: [],
    messages: parsed.messages,
    mode: 'collect',
    projectId: parsed.projectId,
  });
  await persistCollectionVersion({
    database: input.database,
    interpretedInput: cleaned,
    plan: { collectionStep: 'await_target', nodes: ['await_target'] },
    projectId: input.identity.projectId,
    request: input.request,
    tenantId: input.identity.tenantId,
    version: input.version,
  });
  return input.reply(
    input.identity.locale,
    editImageGuidance[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditImageShopifyPlanConfirm = async (input: Readonly<{
  database: ScopedDatabase;
  graphVersion: string;
  identity: ResolvedIdentity;
  onQueued: (input: Readonly<{
    database: ScopedDatabase;
    request: typeof schema.requests.$inferSelect;
    requestVersionId: string;
  }>) => Promise<void>;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditImageCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'ready')
    throw new Error(
      'Edit theme image plan confirm is invalid for this request state.',
    );
  if (
    parsed.targetKey === undefined ||
    parsed.replacementArtifactKey === undefined ||
    parsed.replacementMime === undefined
  )
    throw new DomainError(
      'validation_error',
      'Edit theme image plan is incomplete.',
      { code: 'image_replacement_missing' },
    );
  const executeInput = parseEditImageExecuteInput(
    input.identity.projectId,
    parsed,
  );
  const nextVersion = input.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  const now = new Date();
  const topicSlug =
    parsed.discoveredTargets.find((target) => target.key === parsed.targetKey)
      ?.pageOrPostSlug ?? 'theme';
  await input.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'QUEUED',
      topic: `Theme image · ${topicSlug}`,
      updatedAt: now,
      version: input.request.version + 1,
    })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editImageShopifyDefinition.version,
    confirmedAt: now,
    id: requestVersionId,
    interpretedInput: executeInput as CapabilityInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: {
      nodes: ['plan_confirmed'],
      replacementArtifactKey: executeInput.replacementArtifactKey,
      targetKey: executeInput.targetKey,
    },
    projectId: input.identity.projectId,
    requestId: input.request.id,
    tenantId: input.identity.tenantId,
    version: nextVersion,
  });
  const graphRunId = uuidv7();
  await input.database.insert(schema.graphRuns).values({
    checkpointSequence: 1,
    currentNode: 'plan_confirmed',
    graphVersion: input.graphVersion,
    id: graphRunId,
    projectId: input.request.projectId,
    requestId: input.request.id,
    requestVersionId,
    status: 'queued',
    tenantId: input.request.tenantId,
  });
  await input.database.insert(schema.workflowCheckpoints).values({
    graphRunId,
    id: uuidv7(),
    node: 'plan_confirmed',
    projectId: input.request.projectId,
    sequence: 1,
    state: { requestState: 'QUEUED' },
    tenantId: input.request.tenantId,
  });
  await input.onQueued({
    database: input.database,
    request: input.request,
    requestVersionId,
  });
  return input.reply(
    input.identity.locale,
    {
      de: 'Bildänderung wird vorbereitet.',
      en: 'Preparing your image edit.',
      es: 'Preparando tu cambio de imagen.',
    }[input.identity.locale],
    input.request.id,
  );
};

/** Helper for loaders that already have a ThemeImageReadPort. */
export const loadThemeInventoryWithExecutor = async (
  reader: ThemeImageReadPort,
  inventoryPath: string = DEFAULT_SURFACE_INVENTORY_PATH,
): Promise<readonly SurfaceInventoryImageRow[]> => {
  const raw = await reader.readFile(inventoryPath);
  if (raw === null || raw.trim().length === 0)
    throw new DomainError(
      'validation_error',
      'Surface inventory is missing; image allowlist is empty.',
      { code: 'surface_inventory_missing' },
    );
  const rows = parseSurfaceInventoryImages(raw);
  if (rows.length === 0)
    throw new DomainError(
      'validation_error',
      'Surface inventory has no github_theme image rows.',
      { code: 'surface_inventory_empty' },
    );
  return rows;
};

/** @alias continueEditImageShopifyCollection */
export const advanceEditImageShopifyCollection =
  continueEditImageShopifyCollection;
