import { v7 as uuidv7 } from 'uuid';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  editTextStyleInputSchema,
  type CapabilityInput,
  type EditTextStyleInput,
  type SupportedLocale,
  type TelegramReply,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { editTextStyleDefinition } from '@binflow/policies';
import {
  assertSingleFieldKind,
  parseClientHex,
  readTextStyleBaseline,
  resolveMatchedExcerpt,
  resolveTextEditCandidate,
  searchEditableCopy,
  type TextEditCandidate,
} from '@binflow/text';
import type { OrbitypePageSnapshot } from '@binflow/menu';

import {
  buildEditTextStyleDisambiguationMessage,
  buildEditTextStylePlanMessage,
  buildEditTextStyleTargetConfirmMessage,
  editTextStyleActionLabels,
  editTextStyleEmptyMessage,
  editTextStyleGuidance,
  editTextStyleHexCancelledMessage,
  editTextStyleHexPrompt,
  editTextStyleHexRetryMessage,
  editTextStyleLocalePrompt,
  editTextStyleMixedKindsMessage,
  editTextStyleTargetNotFoundMessage,
  formatEditTextStylePickLabel,
  parseEditTextStyleExecuteInput,
  buildEditTextStyleMenuMessage,
  buildEditTextStyleWeightPrompt,
  buildEditTextStyleSizePrompt,
  buildEditTextStyleColorPrompt,
} from './edit-text-style-ingress.js';

export type EditTextStylePagesLoader = (input: Readonly<{
  database: ScopedDatabase;
  manifest: ProjectManifest;
  projectId: string;
  tenantId: string;
}>) => Promise<readonly OrbitypePageSnapshot[]>;

type Identity = Readonly<{
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
  request: Pick<typeof schema.requests.$inferSelect, 'id' | 'projectId' | 'tenantId'>,
  requestVersionId: string,
  userId: string,
  action: string,
) => Promise<string>;
type HasCapabilityFn = (
  database: ScopedDatabase,
  projectId: string,
  capabilityId: string,
) => Promise<boolean>;
type Collect = Extract<EditTextStyleInput, { mode: 'collect' }>;

const parseCollect = (value: unknown): Collect => {
  const parsed = editTextStyleInputSchema.parse(value);
  if (parsed.mode !== 'collect') throw new Error('Expected edit_text_style collect input.');
  return parsed;
};

const persist = async (input: Readonly<{
  database: ScopedDatabase;
  interpretedInput: Collect;
  plan: Record<string, unknown>;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<string> => {
  const id = uuidv7();
  const nextVersion = input.request.currentVersion + 1;
  await input.database
    .update(schema.requests)
    .set({ currentVersion: nextVersion, state: 'NEEDS_INPUT' })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextStyleDefinition.version,
    id,
    interpretedInput: input.interpretedInput as CapabilityInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: input.plan,
    projectId: input.request.projectId,
    requestId: input.request.id,
    tenantId: input.request.tenantId,
    version: nextVersion,
  });
  return id;
};

const cancel = async (
  database: ScopedDatabase,
  request: typeof schema.requests.$inferSelect,
  code: string,
): Promise<void> => {
  await database
    .update(schema.requests)
    .set({
      state: 'CANCELLED',
      terminalResult: { failureCode: code },
      updatedAt: new Date(),
      version: request.version + 1,
    })
    .where(eq(schema.requests.id, request.id));
};

const localeLabel = (locale: SupportedLocale): string =>
  locale === 'de' ? 'Deutsch' : locale === 'en' ? 'English' : 'Español';

const baselineFromCollect = (collect: Collect) => ({
  color: collect.currentColor ?? '#111111',
  fontSizePx: collect.currentFontSizePx ?? 16,
  fontWeight: collect.currentFontWeight ?? 400,
});

const pickTargetTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  matches: readonly TextEditCandidate[];
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const tokens: TelegramReply['actionTokens'] = [];
  for (const [index, candidate] of input.matches.slice(0, 8).entries())
    tokens.push({
      action: 'pick_text_style_target',
      label: formatEditTextStylePickLabel(input.identity.locale, index, candidate),
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        `pick_text_style_target:${candidate.key}`,
      ),
    });
  return tokens;
};

const styleChosenSummary = (
  locale: SupportedLocale,
  collect: Collect,
): string => {
  const labels = editTextStyleActionLabels[locale];
  const parts: string[] = [];
  if (collect.fontWeight !== undefined) {
    const weightLabel =
      collect.fontWeight === 700
        ? labels.weightBold
        : collect.fontWeight === 600
          ? labels.weightSemi
          : labels.weightNormal;
    parts.push(
      {
        de: `Gewicht: ${weightLabel}`,
        en: `Weight: ${weightLabel}`,
        es: `Grosor: ${weightLabel}`,
      }[locale],
    );
  }
  if (collect.fontSizeDeltaPx !== undefined) {
    parts.push(
      {
        de: `Größe: +${String(collect.fontSizeDeltaPx)}`,
        en: `Size: +${String(collect.fontSizeDeltaPx)}`,
        es: `Tamaño: +${String(collect.fontSizeDeltaPx)}`,
      }[locale],
    );
  }
  if (collect.colorMode === 'hex' && collect.hex !== undefined) {
    parts.push(
      {
        de: `Farbe: ${collect.hex}`,
        en: `Color: ${collect.hex}`,
        es: `Color: ${collect.hex}`,
      }[locale],
    );
  } else if (collect.colorMode === 'darken50') {
    parts.push(
      {
        de: `Farbe: ${labels.colorDarker}`,
        en: `Color: ${labels.colorDarker}`,
        es: `Color: ${labels.colorDarker}`,
      }[locale],
    );
  } else if (collect.colorMode === 'lighten50') {
    parts.push(
      {
        de: `Farbe: ${labels.colorLighter}`,
        en: `Color: ${labels.colorLighter}`,
        es: `Color: ${labels.colorLighter}`,
      }[locale],
    );
  }
  return parts.join(' · ');
};

const styleMenuTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const labels = editTextStyleActionLabels[input.identity.locale];
  const definitions = [
    ['pick_text_style_attr', labels.attrWeight, 'pick_text_style_attr:weight'],
    ['pick_text_style_attr', labels.attrSize, 'pick_text_style_attr:size'],
    ['pick_text_style_attr', labels.attrColor, 'pick_text_style_attr:color'],
    ['done_text_style_attrs', labels.doneStyles, 'done_text_style_attrs'],
  ] as const;
  return Promise.all(
    definitions.map(async ([action, label, value]) => ({
      action,
      label,
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        value,
      ),
    })),
  );
};

const styleWeightTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const labels = editTextStyleActionLabels[input.identity.locale];
  const definitions = [
    ['pick_text_style_weight', labels.weightNormal, 'pick_text_style_weight:400'],
    ['pick_text_style_weight', labels.weightSemi, 'pick_text_style_weight:600'],
    ['pick_text_style_weight', labels.weightBold, 'pick_text_style_weight:700'],
  ] as const;
  return Promise.all(
    definitions.map(async ([action, label, value]) => ({
      action,
      label,
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        value,
      ),
    })),
  );
};

const styleSizeTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const labels = editTextStyleActionLabels[input.identity.locale];
  const definitions = [
    ['pick_text_style_size', labels.size4, 'pick_text_style_size:4'],
    ['pick_text_style_size', labels.size8, 'pick_text_style_size:8'],
    ['pick_text_style_size', labels.size16, 'pick_text_style_size:16'],
    ['pick_text_style_size', labels.size32, 'pick_text_style_size:32'],
  ] as const;
  return Promise.all(
    definitions.map(async ([action, label, value]) => ({
      action,
      label,
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        value,
      ),
    })),
  );
};

const styleColorTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const labels = editTextStyleActionLabels[input.identity.locale];
  const definitions = [
    ['pick_text_style_color', labels.colorDarker, 'pick_text_style_color:darken50'],
    ['pick_text_style_color', labels.colorLighter, 'pick_text_style_color:lighten50'],
    ['pick_text_style_color', labels.enterHex, 'pick_text_style_color:hex'],
  ] as const;
  return Promise.all(
    definitions.map(async ([action, label, value]) => ({
      action,
      label,
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        value,
      ),
    })),
  );
};

const replyStyleMenu = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  next: Collect;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply> => {
  const baseline = baselineFromCollect(input.next);
  return input.reply(
    input.identity.locale,
    buildEditTextStyleMenuMessage(
      input.identity.locale,
      baseline,
      styleChosenSummary(input.identity.locale, input.next),
    ),
    input.request.id,
    await styleMenuTokens({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      request: input.request,
      requestVersionId: input.requestVersionId,
    }),
  );
};

export const createEditTextStyleRequest = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  hasCapability: HasCapabilityFn;
  identity: Identity;
  initialQuery?: string;
  loadPages?: EditTextStylePagesLoader;
  reply: ReplyFn;
}>): Promise<TelegramReply> => {
  if (!(await input.hasCapability(input.database, input.identity.projectId, 'edit_text_style')))
    return input.reply(input.identity.locale, editTextStyleGuidance[input.identity.locale], null);
  const [manifest] = await input.database
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
  if (manifest === undefined)
    return input.reply(input.identity.locale, editTextStyleGuidance[input.identity.locale], null);
  const step = manifest.document.contentLocales.length > 1 ? 'await_locale' : 'await_target';
  const requestId = uuidv7();
  const requestVersionId = uuidv7();
  const interpretedInput = parseCollect({
    collectionStep: step,
    mode: 'collect',
    projectId: input.identity.projectId,
    ...(step === 'await_target'
      ? { contentLocale: manifest.document.contentLocales[0] }
      : {}),
  });
  await input.database.insert(schema.requests).values({
    capabilityId: 'edit_text_style',
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT',
    tenantId: input.identity.tenantId,
    topic: 'Text style',
    userId: input.identity.userId,
  });
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextStyleDefinition.version,
    id: requestVersionId,
    interpretedInput,
    manifestVersionId: manifest.id,
    plan: { collectionStep: step, nodes: [step] },
    projectId: input.identity.projectId,
    requestId,
    tenantId: input.identity.tenantId,
    version: 1,
  });
  if (step === 'await_locale') {
    const tokens: TelegramReply['actionTokens'] = [];
    for (const locale of manifest.document.contentLocales.slice(0, 3))
      tokens.push({
        action: 'pick_text_style_locale',
        label: localeLabel(locale),
        token: await input.createAction(
          input.database,
          { id: requestId, projectId: input.identity.projectId, tenantId: input.identity.tenantId },
          requestVersionId,
          input.identity.userId,
          `pick_text_style_locale:${locale}`,
        ),
      });
    return input.reply(input.identity.locale, editTextStyleLocalePrompt[input.identity.locale], requestId, tokens);
  }
  if (input.initialQuery?.trim() && input.loadPages !== undefined) {
    const [request] = await input.database.select().from(schema.requests).where(eq(schema.requests.id, requestId)).limit(1);
    const [version] = await input.database.select().from(schema.requestVersions).where(eq(schema.requestVersions.id, requestVersionId)).limit(1);
    if (request !== undefined && version !== undefined)
      return continueEditTextStyleCollection({
        createAction: input.createAction,
        database: input.database,
        identity: input.identity,
        loadPages: input.loadPages,
        reply: input.reply,
        request,
        text: input.initialQuery,
        version,
      });
  }
  return input.reply(input.identity.locale, editTextStyleGuidance[input.identity.locale], requestId);
};

export const continueEditTextStyleCollection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  loadPages: EditTextStylePagesLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  text: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseCollect(input.version.interpretedInput);
  const [manifest] = await input.database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifest === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);
  if (previous.collectionStep === 'await_hex') {
    const hex = parseClientHex(input.text);
    if (hex === null) {
      if (previous.hexAttempts >= 2) {
        await cancel(input.database, input.request, 'text_style_color_invalid');
        return input.reply(input.identity.locale, editTextStyleHexCancelledMessage[input.identity.locale], input.request.id);
      }
      const attempts = previous.hexAttempts + 1;
      const next = parseCollect({ ...previous, hexAttempts: attempts });
      await persist({
        database: input.database,
        interpretedInput: next,
        plan: { collectionStep: 'await_hex', nodes: ['await_hex'] },
        request: input.request,
        version: input.version,
      });
      return input.reply(input.identity.locale, editTextStyleHexRetryMessage[input.identity.locale], input.request.id);
    }
    const next = parseCollect({
      ...previous,
      collectionStep: 'await_style',
      colorMode: 'hex',
      hex,
    });
    const id = await persist({
      database: input.database,
      interpretedInput: next,
      plan: { collectionStep: 'await_style', nodes: ['await_style'] },
      request: input.request,
      version: input.version,
    });
    return replyStyleMenu({
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      next,
      reply: input.reply,
      request: input.request,
      requestVersionId: id,
    });
  }
  if (previous.collectionStep !== 'await_target')
    return input.reply(input.identity.locale, editTextStyleGuidance[input.identity.locale], input.request.id);
  if (previous.contentLocale === undefined)
    return input.reply(input.identity.locale, editTextStyleLocalePrompt[input.identity.locale], input.request.id);
  const pages = await input.loadPages({
    database: input.database,
    manifest: manifest.document,
    projectId: input.identity.projectId,
    tenantId: input.identity.tenantId,
  });
  const matches = searchEditableCopy(
    pages,
    manifest.document.contentLocales,
    previous.contentLocale,
    input.text.trim(),
  );
  if (matches.length === 0)
    return input.reply(
      input.identity.locale,
      editTextStyleTargetNotFoundMessage[input.identity.locale],
      input.request.id,
    );
  try {
    assertSingleFieldKind(matches);
  } catch {
    await cancel(input.database, input.request, 'text_style_mixed_field_kinds');
    return input.reply(input.identity.locale, editTextStyleMixedKindsMessage[input.identity.locale], input.request.id);
  }
  const step = matches.length === 1 ? 'confirm_target' : 'disambiguate';
  const target = matches.length === 1 ? matches[0] : undefined;
  const query = input.text.trim();
  const excerpt =
    target === undefined
      ? query
      : (resolveMatchedExcerpt(target.currentValue, query) ?? query);
  const next = parseCollect({
    ...previous,
    collectionStep: step,
    discoveredTargets: matches,
    fieldKind: assertSingleFieldKind(matches),
    targetExcerpt: excerpt,
    ...(target === undefined ? {} : { targetKey: target.key }),
  });
  const id = await persist({
    database: input.database,
    interpretedInput: next,
    plan: { collectionStep: step, nodes: [step] },
    request: input.request,
    version: input.version,
  });
  if (target !== undefined) {
    const token = await input.createAction(input.database, input.request, id, input.identity.userId, 'confirm_text_style_target');
    return input.reply(
      input.identity.locale,
      buildEditTextStyleTargetConfirmMessage(input.identity.locale, target, excerpt),
      input.request.id,
      [{ action: 'confirm_text_style_target', label: editTextStyleActionLabels[input.identity.locale].confirmTarget, token }],
    );
  }
  return input.reply(
    input.identity.locale,
    buildEditTextStyleDisambiguationMessage(input.identity.locale, matches),
    input.request.id,
    await pickTargetTokens({ ...input, matches, requestVersionId: id }),
  );
};

export const consumeEditTextStyleLocalePick = async (input: Readonly<{
  contentLocale: SupportedLocale;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  const next = parseCollect({ ...parsed, collectionStep: 'await_target', contentLocale: input.contentLocale });
  await persist({ database: input.database, interpretedInput: next, plan: { collectionStep: 'await_target', nodes: ['await_target'] }, request: input.request, version: input.version });
  return input.reply(input.identity.locale, editTextStyleGuidance[input.identity.locale], input.request.id);
};

export const consumeEditTextStyleTargetPick = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  targetKey: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  const target = parsed.discoveredTargets.find((item) => item.key === input.targetKey);
  if (target === undefined)
    return input.reply(input.identity.locale, editTextStyleGuidance[input.identity.locale], input.request.id);
  const excerpt =
    parsed.targetExcerpt === undefined
      ? target.currentValue
      : (resolveMatchedExcerpt(target.currentValue, parsed.targetExcerpt) ??
        parsed.targetExcerpt);
  const next = parseCollect({
    ...parsed,
    collectionStep: 'confirm_target',
    targetExcerpt: excerpt,
    targetKey: target.key,
  });
  const id = await persist({ database: input.database, interpretedInput: next, plan: { collectionStep: 'confirm_target', nodes: ['confirm_target'] }, request: input.request, version: input.version });
  const token = await input.createAction(input.database, input.request, id, input.identity.userId, 'confirm_text_style_target');
  return input.reply(input.identity.locale, buildEditTextStyleTargetConfirmMessage(input.identity.locale, target, excerpt), input.request.id, [
    { action: 'confirm_text_style_target', label: editTextStyleActionLabels[input.identity.locale].confirmTarget, token },
  ]);
};

export const consumeEditTextStyleTargetConfirm = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  loadPages: EditTextStylePagesLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  const [manifest] = await input.database.select({ document: schema.projectManifestVersions.document }).from(schema.projectManifestVersions).where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId)).limit(1);
  if (manifest === undefined || parsed.targetKey === undefined)
    throw new DomainError('validation_error', 'Text style target context is missing.');
  const pages = await input.loadPages({ database: input.database, manifest: manifest.document, projectId: input.identity.projectId, tenantId: input.identity.tenantId });
  const target = resolveTextEditCandidate(pages, manifest.document.contentLocales, parsed.targetKey);
  const page = target === null ? undefined : pages.find((item) => item.id === target.pageId);
  if (target === null || page === undefined)
    throw new DomainError('validation_error', 'Text style target is missing.', { code: 'text_target_not_found' });
  const baseline = readTextStyleBaseline(page.sections, target);
  const next = parseCollect({
    ...parsed,
    collectionStep: 'await_style',
    currentColor: baseline.color,
    currentFontSizePx: baseline.fontSizePx,
    currentFontWeight: baseline.fontWeight,
  });
  const id = await persist({ database: input.database, interpretedInput: next, plan: { collectionStep: 'await_style', nodes: ['await_style'] }, request: input.request, version: input.version });
  return replyStyleMenu({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    next,
    reply: input.reply,
    request: input.request,
    requestVersionId: id,
  });
};

const consumeStyleChoice = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  patch: Partial<Collect>;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  const next = parseCollect({ ...parsed, ...input.patch, collectionStep: 'await_style' });
  const id = await persist({ database: input.database, interpretedInput: next, plan: { collectionStep: 'await_style', nodes: ['await_style'] }, request: input.request, version: input.version });
  return replyStyleMenu({
    createAction: input.createAction,
    database: input.database,
    identity: input.identity,
    next,
    reply: input.reply,
    request: input.request,
    requestVersionId: id,
  });
};

export const consumeEditTextStyleAttrPick = async (input: Readonly<{
  attr: 'weight' | 'size' | 'color';
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  const step =
    input.attr === 'weight'
      ? 'await_style_weight'
      : input.attr === 'size'
        ? 'await_style_size'
        : 'await_style_color';
  const next = parseCollect({ ...parsed, collectionStep: step });
  const id = await persist({
    database: input.database,
    interpretedInput: next,
    plan: { collectionStep: step, nodes: [step] },
    request: input.request,
    version: input.version,
  });
  if (input.attr === 'weight')
    return input.reply(
      input.identity.locale,
      buildEditTextStyleWeightPrompt(input.identity.locale),
      input.request.id,
      await styleWeightTokens({ ...input, requestVersionId: id }),
    );
  if (input.attr === 'size')
    return input.reply(
      input.identity.locale,
      buildEditTextStyleSizePrompt(input.identity.locale),
      input.request.id,
      await styleSizeTokens({ ...input, requestVersionId: id }),
    );
  return input.reply(
    input.identity.locale,
    buildEditTextStyleColorPrompt(input.identity.locale),
    input.request.id,
    await styleColorTokens({ ...input, requestVersionId: id }),
  );
};

export const consumeEditTextStyleWeightPick = async (input: Omit<Parameters<typeof consumeStyleChoice>[0], 'patch'> & { fontWeight: 400 | 600 | 700 }): Promise<TelegramReply> =>
  consumeStyleChoice({ ...input, patch: { fontWeight: input.fontWeight } });

export const consumeEditTextStyleSizePick = async (input: Omit<Parameters<typeof consumeStyleChoice>[0], 'patch'> & { fontSizeDeltaPx: 4 | 8 | 16 | 32 }): Promise<TelegramReply> =>
  consumeStyleChoice({ ...input, patch: { fontSizeDeltaPx: input.fontSizeDeltaPx } });

export const consumeEditTextStyleColorPick = async (input: Omit<Parameters<typeof consumeStyleChoice>[0], 'patch'> & { colorMode: 'hex' | 'darken50' | 'lighten50' }): Promise<TelegramReply> => {
  if (input.colorMode !== 'hex')
    return consumeStyleChoice({ ...input, patch: { colorMode: input.colorMode } });
  const parsed = parseCollect(input.version.interpretedInput);
  const next = parseCollect({ ...parsed, collectionStep: 'await_hex', colorMode: 'hex', hexAttempts: 0 });
  await persist({ database: input.database, interpretedInput: next, plan: { collectionStep: 'await_hex', nodes: ['await_hex'] }, request: input.request, version: input.version });
  return input.reply(input.identity.locale, editTextStyleHexPrompt[input.identity.locale], input.request.id);
};

export const consumeEditTextStyleAttrsDone = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  if (parsed.fontWeight === undefined && parsed.fontSizeDeltaPx === undefined && parsed.colorMode === undefined)
    return input.reply(input.identity.locale, editTextStyleEmptyMessage[input.identity.locale], input.request.id);
  const target = parsed.discoveredTargets.find((item) => item.key === parsed.targetKey);
  if (target === undefined) throw new DomainError('validation_error', 'Text style target is missing.');
  const next = parseCollect({ ...parsed, collectionComplete: true, collectionStep: 'ready' });
  const id = await persist({ database: input.database, interpretedInput: next, plan: { collectionStep: 'ready', nodes: ['plan_confirm'] }, request: input.request, version: input.version });
  const execute = parseEditTextStyleExecuteInput(input.identity.projectId, next);
  const token = await input.createAction(input.database, input.request, id, input.identity.userId, 'confirm_text_style_plan');
  return input.reply(input.identity.locale, buildEditTextStylePlanMessage(input.identity.locale, target, execute.style), input.request.id, [
    { action: 'confirm_text_style_plan', label: editTextStyleActionLabels[input.identity.locale].confirmPlan, token },
  ]);
};

export const consumeEditTextStylePlanConfirm = async (input: Readonly<{
  database: ScopedDatabase;
  graphVersion: string;
  identity: Identity;
  onQueued: (input: Readonly<{ database: ScopedDatabase; request: typeof schema.requests.$inferSelect; requestVersionId: string }>) => Promise<void>;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = parseCollect(input.version.interpretedInput);
  if (parsed.collectionStep !== 'ready')
    throw new DomainError('validation_error', 'Text style plan is incomplete.', { code: 'text_style_empty' });
  if (parsed.targetExcerpt === undefined)
    throw new DomainError('validation_error', 'Text style excerpt is missing.', { code: 'text_target_not_found' });
  const execute = parseEditTextStyleExecuteInput(input.identity.projectId, parsed);
  const nextVersion = input.request.currentVersion + 1;
  const id = uuidv7();
  const now = new Date();
  await input.database.update(schema.requests).set({
    currentVersion: nextVersion,
    state: 'QUEUED',
    topic: `Text style · /${parsed.discoveredTargets.find((item) => item.key === parsed.targetKey)?.pageSlug ?? 'page'}`,
    updatedAt: now,
    version: input.request.version + 1,
  }).where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: editTextStyleDefinition.version,
    confirmedAt: now,
    id,
    interpretedInput: execute as CapabilityInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: { nodes: ['plan_confirmed'], style: execute.style, targetKey: execute.targetKey },
    projectId: input.request.projectId,
    requestId: input.request.id,
    tenantId: input.request.tenantId,
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
    requestVersionId: id,
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
  await input.onQueued({ database: input.database, request: input.request, requestVersionId: id });
  return input.reply(input.identity.locale, {
    de: 'Der Textstil wird vorbereitet.',
    en: 'Preparing your text style change.',
    es: 'Preparando tu cambio de estilo.',
  }[input.identity.locale], input.request.id);
};
