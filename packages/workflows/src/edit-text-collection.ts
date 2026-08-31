import { v7 as uuidv7 } from 'uuid';

import {
  editTextInputSchema,
  type CapabilityInput,
  type EditTextInput,
  type SupportedLocale,
  type TelegramReply,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { editTextDefinition } from '@binflow/policies';
import {
  resolveTextEditCandidate,
  searchEditableCopy,
  type TextEditCandidate,
} from '@binflow/text';
import type { OrbitypePageSnapshot } from '@binflow/menu';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  buildEditTextDisambiguationMessage,
  buildEditTextPlanMessage,
  buildEditTextTargetConfirmMessage,
  editTextActionLabels,
  editTextEmptyReplacementMessage,
  editTextGuidance,
  editTextLocalePrompt,
  editTextReplacementPrompt,
  editTextTargetNotFoundMessage,
  formatEditTextPickLabel,
  parseEditTextExecuteInput,
} from './edit-text-ingress.js';

export type EditTextPagesLoader = (input: Readonly<{
  database: ScopedDatabase;
  manifest: ProjectManifest;
  projectId: string;
  tenantId: string;
}>) => Promise<readonly OrbitypePageSnapshot[]>;

type ResolvedIdentity = Readonly<{
  conversationId: string;
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

type EditTextCollectInput = Extract<EditTextInput, { mode: 'collect' }>;

const parseEditTextCollect = (value: unknown): EditTextCollectInput => {
  const parsed = editTextInputSchema.parse(value);
  if (parsed.mode !== 'collect')
    throw new Error('Expected edit_text collect input.');
  return parsed;
};

const collectionStepForLocales = (
  contentLocales: readonly SupportedLocale[],
): Extract<EditTextInput, { mode: 'collect' }>['collectionStep'] =>
  contentLocales.length > 1 ? 'await_locale' : 'await_target';

const persistCollectionVersion = async (input: Readonly<{
  database: ScopedDatabase;
  interpretedInput: EditTextCollectInput;
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
    capabilityVersion: editTextDefinition.version,
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

const localeLabel = (locale: SupportedLocale): string => {
  if (locale === 'de') return 'Deutsch';
  if (locale === 'en') return 'English';
  return 'Español';
};

export const createEditTextRequest = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  hasCapability: HasCapabilityFn;
  identity: ResolvedIdentity;
  reply: ReplyFn;
}>): Promise<TelegramReply> => {
  if (
    !(await input.hasCapability(input.database, input.identity.projectId, 'edit_text'))
  )
    return input.reply(input.identity.locale, editTextGuidance[input.identity.locale], null);

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
    return input.reply(input.identity.locale, editTextGuidance[input.identity.locale], null);

  const collectionStep = collectionStepForLocales(
    manifestRow.document.contentLocales,
  );
  const requestId = uuidv7();
  const requestVersionId = uuidv7();
  const interpretedInput = parseEditTextCollect({
    collectionStep,
    mode: 'collect',
    projectId: input.identity.projectId,
    ...(collectionStep === 'await_target'
      ? { contentLocale: manifestRow.document.contentLocales[0] }
      : {}),
  });
  await input.database.insert(schema.requests).values({
    capabilityId: 'edit_text',
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT',
    tenantId: input.identity.tenantId,
    topic: 'Text edit',
    userId: input.identity.userId,
  });
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextDefinition.version,
    id: requestVersionId,
    interpretedInput,
    manifestVersionId: manifestRow.id,
    plan: { collectionStep, nodes: [collectionStep] },
    projectId: input.identity.projectId,
    requestId,
    tenantId: input.identity.tenantId,
    version: 1,
  });

  if (collectionStep === 'await_locale') {
    const actionTokens: TelegramReply['actionTokens'] = [];
    for (const locale of manifestRow.document.contentLocales.slice(0, 3)) {
      actionTokens.push({
        action: 'pick_text_locale',
        label: localeLabel(locale),
        token: await input.createAction(
          input.database,
          { id: requestId, projectId: input.identity.projectId, tenantId: input.identity.tenantId },
          requestVersionId,
          input.identity.userId,
          `pick_text_locale:${locale}`,
        ),
      });
    }
    return input.reply(
      input.identity.locale,
      editTextLocalePrompt[input.identity.locale],
      requestId,
      actionTokens,
    );
  }

  return input.reply(
    input.identity.locale,
    editTextGuidance[input.identity.locale],
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
      action: 'pick_text_target',
      label: formatEditTextPickLabel(
        input.identity.locale,
        index,
        candidate,
      ),
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        `pick_text_target:${candidate.key}`,
      ),
    });
  }
  return actionTokens;
};

export const continueEditTextCollection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadPages: EditTextPagesLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  text: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseEditTextCollect(input.version.interpretedInput);
  if (previous.mode !== 'collect')
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  const [manifestRow] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  const contentLocale = previous.contentLocale;
  if (contentLocale === undefined)
    return input.reply(
      input.identity.locale,
      editTextLocalePrompt[input.identity.locale],
      input.request.id,
    );

  const pages = await input.loadPages({
    database: input.database,
    manifest: manifestRow.document,
    projectId: input.identity.projectId,
    tenantId: input.identity.tenantId,
  });

  if (previous.collectionStep === 'await_target') {
    const query = input.text.trim();
    if (query.length === 0)
      return input.reply(
        input.identity.locale,
        editTextGuidance[input.identity.locale],
        input.request.id,
      );
    const matches = searchEditableCopy(
      pages,
      manifestRow.document.contentLocales,
      contentLocale,
      query,
    );
    if (matches.length === 0)
      return input.reply(
        input.identity.locale,
        editTextTargetNotFoundMessage[input.identity.locale],
        input.request.id,
      );
    if (matches.length === 1) {
      const target = matches[0]!;
      const interpretedInput = parseEditTextCollect({
        ...previous,
        collectionStep: 'confirm_target',
        discoveredTargets: matches,
        targetKey: target.key,
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
      const actionTokens: TelegramReply['actionTokens'] = [
        {
          action: 'confirm_text_target',
          label: editTextActionLabels[input.identity.locale].confirmTarget,
          token: await input.createAction(
            input.database,
            input.request,
            requestVersionId,
            input.identity.userId,
            'confirm_text_target',
          ),
        },
      ];
      return input.reply(
        input.identity.locale,
        buildEditTextTargetConfirmMessage(input.identity.locale, target),
        input.request.id,
        actionTokens,
      );
    }
    const interpretedInput = parseEditTextCollect({
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
      buildEditTextDisambiguationMessage(input.identity.locale, matches),
      input.request.id,
      actionTokens,
    );
  }

  if (previous.collectionStep === 'await_replacement') {
    const newValue = input.text.trim();
    if (newValue.length === 0)
      return input.reply(
        input.identity.locale,
        editTextEmptyReplacementMessage[input.identity.locale],
        input.request.id,
      );
    const target = previous.targetKey === undefined
      ? null
      : resolveTextEditCandidate(
          pages,
          manifestRow.document.contentLocales,
          previous.targetKey,
        );
    if (target === null)
      return input.reply(
        input.identity.locale,
        editTextTargetNotFoundMessage[input.identity.locale],
        input.request.id,
      );
    const interpretedInput = parseEditTextCollect({
      ...previous,
      collectionStep: 'ready',
      collectionComplete: true,
      newValue,
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
        action: 'confirm_text_plan',
        label: editTextActionLabels[input.identity.locale].confirmPlan,
        token: await input.createAction(
          input.database,
          input.request,
          requestVersionId,
          input.identity.userId,
          'confirm_text_plan',
        ),
      },
    ];
    return input.reply(
      input.identity.locale,
      buildEditTextPlanMessage(input.identity.locale, target, newValue),
      input.request.id,
      actionTokens,
    );
  }

  return input.reply(
    input.identity.locale,
    previous.collectionStep === 'confirm_target'
      ? editTextReplacementPrompt[input.identity.locale]
      : editTextGuidance[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditTextLocalePick = async (input: Readonly<{
  contentLocale: SupportedLocale;
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditTextCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'await_locale')
    throw new Error('Edit text locale pick is invalid for this request state.');
  const interpretedInput = parseEditTextCollect({
    ...parsed,
    collectionStep: 'await_target',
    contentLocale: input.contentLocale,
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
    editTextGuidance[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditTextTargetPick = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  targetKey: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditTextCollect(input.version.interpretedInput);
  if (
    parsed.mode !== 'collect' ||
    (parsed.collectionStep !== 'disambiguate' &&
      parsed.collectionStep !== 'await_target')
  )
    throw new Error('Edit text target pick is invalid for this request state.');
  const target = parsed.discoveredTargets.find(
    (candidate) => candidate.key === input.targetKey,
  );
  if (target === undefined)
    return input.reply(
      input.identity.locale,
      editTextTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  const interpretedInput = parseEditTextCollect({
    ...parsed,
    collectionStep: 'confirm_target',
    targetKey: target.key,
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
  const actionTokens: TelegramReply['actionTokens'] = [
    {
      action: 'confirm_text_target',
      label: editTextActionLabels[input.identity.locale].confirmTarget,
      token: await input.createAction(
        input.database,
        input.request,
        requestVersionId,
        input.identity.userId,
        'confirm_text_target',
      ),
    },
  ];
  return input.reply(
    input.identity.locale,
    buildEditTextTargetConfirmMessage(input.identity.locale, target),
    input.request.id,
    actionTokens,
  );
};

export const consumeEditTextTargetConfirm = async (input: Readonly<{
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseEditTextCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'confirm_target')
    throw new Error('Edit text target confirm is invalid for this request state.');
  const interpretedInput = parseEditTextCollect({
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
    editTextReplacementPrompt[input.identity.locale],
    input.request.id,
  );
};

export const consumeEditTextPlanConfirm = async (input: Readonly<{
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
  const parsed = parseEditTextCollect(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'ready')
    throw new Error('Edit text plan confirm is invalid for this request state.');
  if (
    parsed.targetKey === undefined ||
    parsed.newValue === undefined ||
    parsed.contentLocale === undefined
  )
    throw new DomainError(
      'validation_error',
      'Edit text plan is incomplete.',
    );
  const executeInput = parseEditTextExecuteInput(input.identity.projectId, parsed);
  const nextVersion = input.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  const now = new Date();
  await input.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'QUEUED',
      topic: `Text · /${parsed.discoveredTargets.find((target) => target.key === parsed.targetKey)?.pageSlug ?? 'page'}`,
      updatedAt: now,
      version: input.request.version + 1,
    })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextDefinition.version,
    confirmedAt: now,
    id: requestVersionId,
    interpretedInput: executeInput as CapabilityInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: {
      newValue: executeInput.newValue,
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
