import { v7 as uuidv7 } from 'uuid';

import {
  editTextShopifyInputSchema,
  type CapabilityInput,
  type EditTextShopifyInput,
  type ProjectManifest,
  type SupportedLocale,
  type TelegramReply,
  type TextEditCandidate,
} from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import {
  DEFAULT_SURFACE_INVENTORY_PATH,
  enrichInventoryCopyRows,
  enrichInventoryStyleHints,
  listInventoryCopyAreas,
  matchesInventoryStyleHint,
  parseSurfaceInventoryCopy,
  parseSurfaceInventoryStyleHints,
  parseSurfaceInventoryStyleTargets,
  resolveInventoryCopyCandidate,
  searchInventoryCopy,
  type SurfaceInventoryCopyRow,
  type SurfaceInventoryStyleHint,
  type ThemeTextReadPort,
} from '@binflow/text';
import { editTextShopifyDefinition } from '@binflow/policies';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  buildEditTextShopifyDisambiguationMessage,
  buildEditTextShopifyPickActionRows,
  buildEditTextShopifyPlanMessage,
  buildEditTextShopifyTargetConfirmMessage,
  buildEditTextShopifyTargetNotFoundMessage,
  editTextShopifyActionLabels,
  editTextShopifyEmptyReplacementMessage,
  editTextShopifyGuidance,
  editTextShopifyReplacementPrompt,
  editTextShopifyStyleTargetMissMessage,
  editTextShopifyTargetNotFoundMessage,
  formatEditTextShopifyPickLabel,
  parseEditTextShopifyExecuteInput,
} from './edit-text-shopify-ingress.js';

export type ThemeTextInventoryBundle = Readonly<{
  rows: readonly SurfaceInventoryCopyRow[];
  styleHints: readonly SurfaceInventoryStyleHint[];
}>;

export type ThemeTextInventoryLoader = (input: Readonly<{
  database: ScopedDatabase;
  manifest: ProjectManifest;
  projectId: string;
  tenantId: string;
}>) => Promise<ThemeTextInventoryBundle>;

export type ThemeTextInventoryRemapRunner = (input: Readonly<{
  autoMerge: boolean;
  database: ScopedDatabase;
  manifest: ProjectManifest;
  projectId: string;
  requestId: string;
  tenantId: string;
}>) => Promise<
  Readonly<{
    changed: boolean;
    copyRows: readonly SurfaceInventoryCopyRow[];
    pullRequestUrl?: string;
  }>
>;

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

type EditTextShopifyCollectInput = Extract<EditTextShopifyInput, { mode: 'collect' }>;

const parseEditTextShopifyCollect = (value: unknown): EditTextShopifyCollectInput => {
  const parsed = editTextShopifyInputSchema.parse(value);
  if (parsed.mode !== 'collect')
    throw new Error('Expected edit_text_shopify collect input.');
  return parsed;
};

const persistCollectionVersion = async (input: Readonly<{
  database: ScopedDatabase;
  interpretedInput: EditTextShopifyCollectInput;
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
    capabilityVersion: editTextShopifyDefinition.version,
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

const targetConfirmActions = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => [
  {
    action: 'confirm_image_target',
    label: editTextShopifyActionLabels[input.identity.locale].confirmTarget,
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
    label: editTextShopifyActionLabels[input.identity.locale].rejectTarget,
    token: await input.createAction(
      input.database,
      input.request,
      input.requestVersionId,
      input.identity.userId,
      'reject_image_target',
    ),
  },
];

const loadInventoryBundle = async (input: Readonly<{
  database: ScopedDatabase;
  loadInventory: ThemeTextInventoryLoader;
  manifest: ProjectManifest;
  projectId: string;
  tenantId: string;
}>): Promise<ThemeTextInventoryBundle> =>
  input.loadInventory({
    database: input.database,
    manifest: input.manifest,
    projectId: input.projectId,
    tenantId: input.tenantId,
  });

const resolveTarget = (
  rows: readonly SurfaceInventoryCopyRow[],
  key: string,
): TextEditCandidate | null => {
  try {
    return resolveInventoryCopyCandidate(rows, key);
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.metadata.code === 'text_target_not_found'
    )
      return null;
    throw error;
  }
};

export const createEditTextShopifyRequest = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  hasCapability: HasCapabilityFn;
  identity: ResolvedIdentity;
  initialQuery?: string;
  loadInventory?: ThemeTextInventoryLoader;
  reply: ReplyFn;
}>): Promise<TelegramReply> => {
  if (
    !(await input.hasCapability(
      input.database,
      input.identity.projectId,
      'edit_text_shopify',
    ))
  )
    return input.reply(
      input.identity.locale,
      editTextShopifyGuidance[input.identity.locale],
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
      editTextShopifyGuidance[input.identity.locale],
      null,
    );

  const requestId = uuidv7();
  const requestVersionId = uuidv7();
  const interpretedInput = parseEditTextShopifyCollect({
    collectionStep: 'await_target',
    mode: 'collect',
    projectId: input.identity.projectId,
  });
  await input.database.insert(schema.requests).values({
    capabilityId: 'edit_text_shopify',
    clientActorRole: input.identity.clientActorRole,
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT',
    tenantId: input.identity.tenantId,
    topic: 'Theme text edit',
    userId: input.identity.userId,
  });
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextShopifyDefinition.version,
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
      return continueEditTextShopifyCollection({
        createAction: input.createAction,
        database: input.database,
        identity: input.identity,
        loadInventory: input.loadInventory,
        reply: input.reply,
        request: fullRequest,
        text: initialQuery,
        version,
      });
    }
  }

  return input.reply(
    input.identity.locale,
    editTextShopifyGuidance[input.identity.locale],
    requestId,
  );
};

const pickTargetTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  matches: readonly TextEditCandidate[];
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const actionTokens: TelegramReply['actionTokens'] = [];
  for (const [index, candidate] of input.matches.slice(0, 8).entries()) {
    actionTokens.push({
      action: 'pick_image_target',
      label: formatEditTextShopifyPickLabel(
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

const advanceToConfirmTarget = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  previous: EditTextShopifyCollectInput;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  target: TextEditCandidate;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const interpretedInput = parseEditTextShopifyCollect({
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
  return input.reply(
    input.identity.locale,
    buildEditTextShopifyTargetConfirmMessage(
      input.identity.locale,
      input.target,
    ),
    input.request.id,
    actionTokens,
  );
};

export const continueEditTextShopifyCollection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadInventory: ThemeTextInventoryLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  text: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseEditTextShopifyCollect(input.version.interpretedInput);
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
        editTextShopifyGuidance[input.identity.locale],
        input.request.id,
      );
    let inventory: ThemeTextInventoryBundle;
    try {
      inventory = await loadInventoryBundle({
        database: input.database,
        loadInventory: input.loadInventory,
        manifest: manifestRow.document,
        projectId: input.identity.projectId,
        tenantId: input.identity.tenantId,
      });
    } catch (error) {
      if (error instanceof DomainError)
        return input.reply(
          input.identity.locale,
          error.message,
          input.request.id,
        );
      throw error;
    }
    const matches = searchInventoryCopy(inventory.rows, query);
    if (matches.length === 0)
      return input.reply(
        input.identity.locale,
        matchesInventoryStyleHint(inventory.styleHints, query)
          ? editTextShopifyStyleTargetMissMessage[input.identity.locale]
          : buildEditTextShopifyTargetNotFoundMessage(
              input.identity.locale,
              listInventoryCopyAreas(inventory.rows),
            ),
        input.request.id,
      );
    if (matches.length === 1) {
      const target = matches[0]!;
      return advanceToConfirmTarget({
        createAction: input.createAction,
        database: input.database,
        identity: input.identity,
        previous: parseEditTextShopifyCollect({
          ...previous,
          discoveredTargets: matches,
        }),
        reply: input.reply,
        request: input.request,
        target,
        version: input.version,
      });
    }
    const interpretedInput = parseEditTextShopifyCollect({
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
      buildEditTextShopifyDisambiguationMessage(input.identity.locale, matches),
      input.request.id,
      actionTokens,
      { actionRows: buildEditTextShopifyPickActionRows(actionTokens) },
    );
  }

  if (previous.collectionStep === 'await_replacement') {
    const newValue = input.text.trim();
    if (newValue.length === 0)
      return input.reply(
        input.identity.locale,
        editTextShopifyEmptyReplacementMessage[input.identity.locale],
        input.request.id,
      );
    return finishReplacementPlan({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      loadInventory: input.loadInventory,
      manifest: manifestRow.document,
      newValue,
      previous,
      reply: input.reply,
      request: input.request,
      version: input.version,
    });
  }

  return input.reply(
    input.identity.locale,
    previous.collectionStep === 'confirm_target'
      ? editTextShopifyReplacementPrompt[input.identity.locale]
      : editTextShopifyGuidance[input.identity.locale],
    input.request.id,
  );
};

const finishReplacementPlan = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadInventory: ThemeTextInventoryLoader;
  manifest: ProjectManifest;
  newValue: string;
  previous: EditTextShopifyCollectInput;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const rows = (
    await loadInventoryBundle({
      database: input.database,
      loadInventory: input.loadInventory,
      manifest: input.manifest,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    })
  ).rows;  const target =
    input.previous.targetKey === undefined
      ? null
      : resolveTarget(rows, input.previous.targetKey);
  if (target === null)
    return input.reply(
      input.identity.locale,
      editTextShopifyTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  const interpretedInput = parseEditTextShopifyCollect({
    ...input.previous,
    collectionComplete: true,
    collectionStep: 'ready',
    newValue: input.newValue,
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
      label: editTextShopifyActionLabels[input.identity.locale].confirmPlan,
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
    buildEditTextShopifyPlanMessage(
      input.identity.locale,
      target,
      input.newValue,
    ),
    input.request.id,
    actionTokens,
  );
};

export const consumeEditTextShopifyTargetPick = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  targetKey: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditTextShopifyCollect(input.version.interpretedInput);
  if (
    parsed.mode !== 'collect' ||
    (parsed.collectionStep !== 'disambiguate' &&
      parsed.collectionStep !== 'await_target')
  )
    throw new Error(
      'Edit theme text target pick is invalid for this request state.',
    );
  const target = parsed.discoveredTargets.find(
    (candidate) => candidate.key === input.targetKey,
  );
  if (target === undefined)
    return input.reply(
      input.identity.locale,
      editTextShopifyTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  return advanceToConfirmTarget({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    previous: parsed,
    reply: input.reply,
    request: input.request,
    target,
    version: input.version,
  });
};

export const consumeEditTextShopifyTargetConfirm = async (input: Readonly<{
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditTextShopifyCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'confirm_target')
    throw new Error(
      'Edit theme text target confirm is invalid for this request state.',
    );
  const interpretedInput = parseEditTextShopifyCollect({
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
    editTextShopifyReplacementPrompt[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditTextShopifyTargetReject = async (input: Readonly<{
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditTextShopifyCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'confirm_target')
    throw new Error(
      'Edit theme text target reject is invalid for this request state.',
    );
  const cleaned = parseEditTextShopifyCollect({
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
    editTextShopifyGuidance[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditTextShopifyPlanConfirm = async (input: Readonly<{
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
  const parsed = parseEditTextShopifyCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'ready')
    throw new Error(
      'Edit theme text plan confirm is invalid for this request state.',
    );
  if (parsed.targetKey === undefined || parsed.newValue === undefined)
    throw new DomainError(
      'validation_error',
      'Edit theme text plan is incomplete.',
      { code: 'text_replacement_missing' },
    );
  const executeInput = parseEditTextShopifyExecuteInput(
    input.identity.projectId,
    parsed,
  );
  const nextVersion = input.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  const now = new Date();
  const topicSlug =
    parsed.discoveredTargets.find((target) => target.key === parsed.targetKey)
      ?.pageSlug ?? 'theme';
  await input.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'QUEUED',
      topic: `Theme text · ${topicSlug}`,
      updatedAt: now,
      version: input.request.version + 1,
    })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextShopifyDefinition.version,
    confirmedAt: now,
    id: requestVersionId,
    interpretedInput: executeInput as CapabilityInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: {
      nodes: ['plan_confirmed'],
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
      de: 'Textänderung wird vorbereitet.',
      en: 'Preparing your text edit.',
      es: 'Preparando tu cambio de texto.',
    }[input.identity.locale],
    input.request.id,
  );
};

/** Helper for loaders that already have a ThemeTextReadPort. */
export const loadThemeTextInventoryWithExecutor = async (
  reader: ThemeTextReadPort,
  inventoryPath: string = DEFAULT_SURFACE_INVENTORY_PATH,
): Promise<ThemeTextInventoryBundle> => {
  const raw = await reader.readFile(inventoryPath);
  if (raw === null || raw.trim().length === 0)
    throw new DomainError(
      'validation_error',
      'Surface inventory is missing; text allowlist is empty.',
      { code: 'surface_inventory_missing' },
    );
  const rows = parseSurfaceInventoryCopy(raw);
  if (rows.length === 0)
    throw new DomainError(
      'validation_error',
      'Surface inventory has no github_theme text rows.',
      { code: 'surface_inventory_empty' },
    );
  const enriched = await enrichInventoryCopyRows(reader, rows);
  if (enriched.length === 0)
    throw new DomainError(
      'validation_error',
      'Surface inventory copy rows have no readable schema default or sample text.',
      { code: 'surface_inventory_empty' },
    );
  const styleHints = await enrichInventoryStyleHints(
    reader,
    parseSurfaceInventoryStyleTargets(raw),
  );
  return Object.freeze({
    rows: enriched,
    styleHints:
      styleHints.length > 0
        ? styleHints
        : parseSurfaceInventoryStyleHints(raw),
  });
};

/** @alias continueEditTextShopifyCollection */
export const advanceEditTextShopifyCollection =
  continueEditTextShopifyCollection;
