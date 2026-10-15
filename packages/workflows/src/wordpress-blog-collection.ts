import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  createBlogWordpressInputSchema,
  wordpressRestManifestSchema,
  type CreateBlogWordpressInput,
  type SupportedLocale,
  type TelegramReply,
  type WordpressRestManifest,
} from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { createBlogWordpressDefinition } from '@binflow/policies';
import type { WordpressCategory } from '@binflow/wordpress';

import {
  WORDPRESS_AS_IS_MIN_BODY_CHARS,
  isSiteImageUrl,
  matchExistingCategoryName,
  nextWordpressBlogStep,
  splitAsIsTitle,
  suggestWordpressCategories,
  wordpressBlogCopy,
} from './wordpress-blog-content.js';

export const WORDPRESS_BLOG_CAPABILITY_ID = 'create_blog_wordpress';

export type WordpressBlogCatalogLoader = (input: Readonly<{
  database: ScopedDatabase;
  manifest: WordpressRestManifest;
  projectId: string;
  tenantId: string;
}>) => Promise<readonly WordpressCategory[]>;

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
  extras?: Readonly<{ actionRows?: TelegramReply['actionRows'] }>,
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

type ActionName = TelegramReply['actionTokens'][number]['action'];
type ButtonSpec = Readonly<{ action: ActionName; label: string; token: string }>;

type CollectInput = Extract<CreateBlogWordpressInput, { mode: 'collect' }>;

type CollectionContext = Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  loadCatalog?: WordpressBlogCatalogLoader;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>;

const latestWordpressManifest = async (
  database: ScopedDatabase,
  projectId: string,
): Promise<
  Readonly<{ document: WordpressRestManifest; id: string }> | undefined
> => {
  const [row] = await database
    .select({
      document: schema.projectManifestVersions.document,
      id: schema.projectManifestVersions.id,
    })
    .from(schema.projectManifestVersions)
    .where(
      and(
        eq(schema.projectManifestVersions.projectId, projectId),
        inArray(schema.projectManifestVersions.status, ['validated', 'active']),
      ),
    )
    .orderBy(desc(schema.projectManifestVersions.version))
    .limit(1);
  if (row === undefined) return undefined;
  const parsed = wordpressRestManifestSchema.safeParse(row.document);
  return parsed.success ? { document: parsed.data, id: row.id } : undefined;
};

const manifestById = async (
  database: ScopedDatabase,
  manifestVersionId: string,
): Promise<WordpressRestManifest> => {
  const [row] = await database
    .select({ document: schema.projectManifestVersions.document })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, manifestVersionId))
    .limit(1);
  const parsed = wordpressRestManifestSchema.safeParse(row?.document);
  if (!parsed.success)
    throw new DomainError(
      'validation_error',
      'WordPress manifest for this request is unavailable.',
    );
  return parsed.data;
};

const tokenRows = async (
  context: Pick<CollectionContext, 'createAction' | 'database' | 'identity'> &
    Readonly<{
      request: Pick<typeof schema.requests.$inferSelect, 'id' | 'projectId' | 'tenantId'>;
      requestVersionId: string;
    }>,
  rows: readonly (readonly Readonly<{
    action: ActionName;
    label: string;
    tokenAction: string;
  }>[])[],
): Promise<
  Readonly<{
    actionRows: ButtonSpec[][];
    actionTokens: ButtonSpec[];
  }>
> => {
  const actionRows: ButtonSpec[][] = [];
  for (const row of rows) {
    const built: ButtonSpec[] = [];
    for (const spec of row)
      built.push({
        action: spec.action,
        label: spec.label,
        token: await context.createAction(
          context.database,
          context.request,
          context.requestVersionId,
          context.identity.userId,
          spec.tokenAction,
        ),
      });
    actionRows.push(built);
  }
  return { actionRows, actionTokens: actionRows.flat() };
};

const cancelRow = (locale: SupportedLocale) =>
  [
    {
      action: 'cancel' as const,
      label: wordpressBlogCopy[locale].cancel,
      tokenAction: 'cancel',
    },
  ] as const;

const persistCollect = async (
  context: CollectionContext,
  next: CollectInput,
): Promise<string> => {
  const nextVersion = context.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  await context.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'NEEDS_INPUT',
      ...(next.title === undefined ? {} : { topic: next.title }),
    })
    .where(eq(schema.requests.id, context.request.id));
  await context.database.insert(schema.requestVersions).values({
    capabilityVersion: createBlogWordpressDefinition.version,
    id: requestVersionId,
    interpretedInput: createBlogWordpressInputSchema.parse(next),
    manifestVersionId: context.version.manifestVersionId,
    plan: { collectionStep: next.collectionStep, nodes: ['collect_inputs'] },
    projectId: context.request.projectId,
    requestId: context.request.id,
    tenantId: context.request.tenantId,
    version: nextVersion,
  });
  return requestVersionId;
};

const describeError = (locale: SupportedLocale, error: unknown): string => {
  if (error instanceof DomainError && error.category === 'provider_retryable')
    return wordpressBlogCopy[locale].timeout;
  throw error;
};

/** Persist `next` at its next gap step and prompt for it. */
const advance = async (
  context: CollectionContext,
  draft: Omit<CollectInput, 'collectionStep'>,
  prefix?: string,
): Promise<TelegramReply> => {
  const locale = context.identity.locale;
  const copy = wordpressBlogCopy[locale];
  const step = nextWordpressBlogStep({ ...draft, collectionStep: 'choose_mode' });

  if (step === 'ready') return toPlanConfirmation(context, { ...draft, collectionStep: 'ready' });

  let suggestions = draft.suggestedCategories;
  if (step === 'choose_category') {
    if (context.loadCatalog === undefined)
      return context.reply(locale, copy.timeout, context.request.id);
    let categories: readonly WordpressCategory[];
    try {
      categories = await context.loadCatalog({
        database: context.database,
        manifest: await manifestById(context.database, context.version.manifestVersionId),
        projectId: context.request.projectId,
        tenantId: context.request.tenantId,
      });
    } catch (error) {
      return context.reply(locale, describeError(locale, error), context.request.id);
    }
    suggestions = suggestWordpressCategories(
      categories,
      `${draft.title ?? ''}\n${draft.content}`,
    ).map((category) => ({ id: category.id, name: category.name }));
  }

  const next: CollectInput = {
    ...draft,
    collectionStep: step,
    suggestedCategories: suggestions,
  };
  const requestVersionId = await persistCollect(context, next);
  const buildRows = (
    rows: readonly (readonly Readonly<{ action: ActionName; label: string; tokenAction: string }>[])[],
  ) =>
    tokenRows(
      { ...context, request: context.request, requestVersionId },
      [...rows, cancelRow(locale)],
    );

  let text: string;
  let rows: Awaited<ReturnType<typeof buildRows>>;
  switch (step) {
    case 'choose_mode':
      text = copy.chooseMode;
      rows = await buildRows([
        [{ action: 'pick_wp_blog_mode', label: copy.asIsButton, tokenAction: 'pick_wp_blog_mode:as_is' }],
        [{ action: 'pick_wp_blog_mode', label: copy.generateButton, tokenAction: 'pick_wp_blog_mode:generate' }],
      ]);
      break;
    case 'await_content': {
      const received = draft.content.trim().length;
      text =
        received === 0
          ? draft.blogMode === 'generate'
            ? copy.guidanceGenerate
            : copy.guidanceAsIs
          : copy.contentReceived(received);
      rows = await buildRows([
        [{ action: 'wp_blog_content_done', label: copy.done, tokenAction: 'wp_blog_content_done' }],
      ]);
      break;
    }
    case 'await_title':
      text = copy.titlePrompt;
      rows = await buildRows([]);
      break;
    case 'await_excerpt':
      text = copy.excerptPrompt;
      rows = await buildRows([
        [{ action: 'wp_blog_skip_excerpt', label: copy.skip, tokenAction: 'wp_blog_skip_excerpt' }],
      ]);
      break;
    case 'choose_category':
      text = copy.chooseCategory;
      rows = await buildRows([
        ...suggestions.map((category) => [
          {
            action: 'pick_wp_blog_category' as const,
            label: category.name.slice(0, 60),
            tokenAction: `pick_wp_blog_category:${String(category.id)}`,
          },
        ]),
        [{ action: 'wp_blog_new_category', label: copy.newCategory, tokenAction: 'wp_blog_new_category' }],
      ]);
      break;
    case 'await_new_category':
      text = copy.newCategoryPrompt;
      rows = await buildRows([]);
      break;
    case 'choose_image':
      text = copy.chooseImage;
      rows = await buildRows([
        [{ action: 'pick_wp_blog_image', label: copy.imageAi, tokenAction: 'pick_wp_blog_image:ai' }],
      ]);
      break;
  }
  return context.reply(
    locale,
    prefix === undefined ? text : `${prefix}\n\n${text}`,
    context.request.id,
    rows.actionTokens,
    { actionRows: rows.actionRows },
  );
};

/** `advance` recomputes `collectionStep`, so the stored step is ignored. */
const draftOf = (input: CollectInput): Omit<CollectInput, 'collectionStep'> => input;

const toPlanConfirmation = async (
  context: CollectionContext,
  collect: CollectInput,
): Promise<TelegramReply> => {
  const locale = context.identity.locale;
  const copy = wordpressBlogCopy[locale];
  if (
    collect.blogMode === undefined ||
    collect.category === undefined ||
    collect.image === undefined
  )
    throw new DomainError('internal_error', 'WordPress blog collection is incomplete.');
  const executeInput = createBlogWordpressInputSchema.parse({
    blogMode: collect.blogMode,
    category: collect.category,
    content: collect.content,
    ...(collect.excerpt === undefined ? {} : { excerpt: collect.excerpt }),
    image: collect.image,
    mode: 'execute',
    projectId: collect.projectId,
    ...(collect.title === undefined ? {} : { title: collect.title }),
  });
  const nextVersion = context.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  const topic =
    collect.title ??
    collect.content.trim().split('\n')[0]?.slice(0, 120) ??
    'Blog';
  await context.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'AWAITING_PLAN_CONFIRMATION',
      topic,
    })
    .where(eq(schema.requests.id, context.request.id));
  await context.database.insert(schema.requestVersions).values({
    capabilityVersion: createBlogWordpressDefinition.version,
    id: requestVersionId,
    interpretedInput: executeInput,
    manifestVersionId: context.version.manifestVersionId,
    plan: {
      blogMode: collect.blogMode,
      categoryKind: collect.category.kind,
      imageSource: collect.image.source,
      nodes: [
        'catalog_sync',
        collect.blogMode === 'as_is' ? 'compose_article' : 'generate',
        ...(collect.image.source === 'ai' ? ['prepare_image'] : []),
        'upload_media',
        'upsert_protected_post',
        'verify_protected_preview',
        'awaiting_client_approval',
      ],
    },
    projectId: context.request.projectId,
    requestId: context.request.id,
    tenantId: context.request.tenantId,
    version: nextVersion,
  });
  const rows = await tokenRows(
    { ...context, requestVersionId },
    [
      [
        { action: 'confirm_plan', label: copy.confirmPlan, tokenAction: 'confirm_plan' },
        { action: 'cancel', label: copy.cancel, tokenAction: 'cancel' },
      ],
    ],
  );
  const imageLabel =
    collect.image.source === 'ai'
      ? copy.planImageAi
      : collect.image.source === 'site_url'
        ? copy.planImageSite
        : copy.planImageTelegram;
  return context.reply(
    locale,
    copy.plan({
      category:
        collect.category.kind === 'new'
          ? copy.planNewCategory(collect.category.name)
          : collect.category.name,
      image: imageLabel,
      mode: collect.blogMode === 'as_is' ? copy.planModeAsIs : copy.planModeGenerate,
      title: collect.title ?? copy.planTitleGenerated,
    }),
    context.request.id,
    rows.actionTokens,
    { actionRows: rows.actionRows },
  );
};

const parseCollect = (
  version: typeof schema.requestVersions.$inferSelect,
): CollectInput => {
  const parsed = createBlogWordpressInputSchema.parse(version.interpretedInput);
  if (parsed.mode !== 'collect')
    throw new DomainError(
      'conflict_error',
      'WordPress blog request is not collecting input.',
    );
  return parsed;
};

export const createWordpressBlogRequest = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  seedText?: string;
}>): Promise<TelegramReply> => {
  const locale = input.identity.locale;
  const manifest = await latestWordpressManifest(
    input.database,
    input.identity.projectId,
  );
  if (manifest === undefined)
    return input.reply(locale, wordpressBlogCopy[locale].notEnabled, null);
  const requestId = uuidv7();
  const requestVersionId = uuidv7();
  const interpretedInput = createBlogWordpressInputSchema.parse({
    collectionStep: 'choose_mode',
    content: input.seedText?.trim() ?? '',
    mode: 'collect',
    projectId: input.identity.projectId,
  });
  const request = {
    capabilityId: WORDPRESS_BLOG_CAPABILITY_ID,
    clientActorRole: input.identity.clientActorRole,
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT' as const,
    tenantId: input.identity.tenantId,
    topic: 'Blog',
    userId: input.identity.userId,
  };
  await input.database.insert(schema.requests).values(request);
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: createBlogWordpressDefinition.version,
    id: requestVersionId,
    interpretedInput,
    manifestVersionId: manifest.id,
    plan: { collectionStep: 'choose_mode', nodes: ['collect_inputs'] },
    projectId: input.identity.projectId,
    requestId,
    tenantId: input.identity.tenantId,
    version: 1,
  });
  const copy = wordpressBlogCopy[locale];
  const rows = await tokenRows(
    {
      createAction: input.createAction,
      database: input.database,
      identity: input.identity,
      request,
      requestVersionId,
    },
    [
      [{ action: 'pick_wp_blog_mode', label: copy.asIsButton, tokenAction: 'pick_wp_blog_mode:as_is' }],
      [{ action: 'pick_wp_blog_mode', label: copy.generateButton, tokenAction: 'pick_wp_blog_mode:generate' }],
      cancelRow(locale),
    ],
  );
  return input.reply(locale, copy.chooseMode, requestId, rows.actionTokens, {
    actionRows: rows.actionRows,
  });
};

/** Free text / photo while the request is in `NEEDS_INPUT`. */
export const continueWordpressBlogCollection = async (
  context: CollectionContext &
    Readonly<{ imageArtifactKey?: string; text: string }>,
): Promise<TelegramReply> => {
  const collect = parseCollect(context.version);
  const locale = context.identity.locale;
  const copy = wordpressBlogCopy[locale];
  const draft = draftOf(collect);
  const text = context.text.trim();
  switch (collect.collectionStep) {
    case 'await_content':
      if (text.length === 0) return advance(context, draft);
      return advance(context, {
        ...draft,
        content: draft.content.length === 0 ? text : `${draft.content}\n\n${text}`,
      });
    case 'await_title':
      if (text.length < 3 || text.length > 200)
        return context.reply(locale, copy.titleInvalid, context.request.id);
      return advance(context, { ...draft, title: text });
    case 'await_excerpt':
      if (text.length > 300)
        return context.reply(locale, copy.excerptTooLong, context.request.id);
      if (text.length === 0) return advance(context, draft);
      return advance(context, { ...draft, excerpt: text });
    case 'await_new_category': {
      if (text.length < 2 || text.length > 60)
        return context.reply(locale, copy.newCategoryPrompt, context.request.id);
      let existing: Readonly<{ id: number; name: string }> | undefined;
      if (context.loadCatalog !== undefined) {
        try {
          existing = matchExistingCategoryName(
            await context.loadCatalog({
              database: context.database,
              manifest: await manifestById(
                context.database,
                context.version.manifestVersionId,
              ),
              projectId: context.request.projectId,
              tenantId: context.request.tenantId,
            }),
            text,
          );
        } catch (error) {
          return context.reply(locale, describeError(locale, error), context.request.id);
        }
      }
      return advance(context, {
        ...draft,
        category:
          existing === undefined
            ? { kind: 'new', name: text }
            : { id: existing.id, kind: 'existing', name: existing.name },
      });
    }
    case 'choose_image': {
      if (context.imageArtifactKey !== undefined)
        return advance(context, {
          ...draft,
          image: { artifactKey: context.imageArtifactKey, source: 'telegram' },
        });
      const manifest = await manifestById(
        context.database,
        context.version.manifestVersionId,
      );
      if (!isSiteImageUrl(text, manifest.wordpress.siteOrigin))
        return context.reply(locale, copy.imageRejected, context.request.id);
      return advance(context, {
        ...draft,
        image: { source: 'site_url', url: new URL(text).href },
      });
    }
    case 'choose_mode':
    case 'choose_category':
    case 'ready':
      return context.reply(locale, copy.pickButton, context.request.id);
  }
};

/** Telegram button handlers for the collection steps. */
export const consumeWordpressBlogAction = async (
  context: CollectionContext & Readonly<{ action: string }>,
): Promise<TelegramReply> => {
  const collect = parseCollect(context.version);
  const draft = draftOf(collect);
  const locale = context.identity.locale;
  const copy = wordpressBlogCopy[locale];
  const [name, value] = context.action.split(':', 2);
  if (name === 'pick_wp_blog_mode' && collect.collectionStep === 'choose_mode') {
    if (value !== 'as_is' && value !== 'generate')
      throw new DomainError('validation_error', 'Unknown blog mode.');
    return advance(context, { ...draft, blogMode: value });
  }
  if (name === 'wp_blog_content_done' && collect.collectionStep === 'await_content') {
    if (draft.blogMode === 'as_is') {
      const split = splitAsIsTitle(draft.content);
      if (split.body.length < WORDPRESS_AS_IS_MIN_BODY_CHARS)
        return context.reply(
          locale,
          copy.contentTooShort(WORDPRESS_AS_IS_MIN_BODY_CHARS),
          context.request.id,
        );
      return advance(context, {
        ...draft,
        ...(draft.title === undefined && split.title !== undefined
          ? { content: split.body, title: split.title }
          : {}),
      });
    }
    return advance(context, draft);
  }
  if (name === 'wp_blog_skip_excerpt' && collect.collectionStep === 'await_excerpt')
    return advance(context, { ...draft, excerptSkipped: true });
  if (name === 'pick_wp_blog_category' && collect.collectionStep === 'choose_category') {
    const picked = collect.suggestedCategories.find(
      (category) => String(category.id) === value,
    );
    if (picked === undefined)
      return context.reply(locale, copy.categoryMissing, context.request.id);
    return advance(context, {
      ...draft,
      category: { id: picked.id, kind: 'existing', name: picked.name },
    });
  }
  if (name === 'wp_blog_new_category' && collect.collectionStep === 'choose_category') {
    const requestVersionId = await persistCollect(context, {
      ...collect,
      collectionStep: 'await_new_category',
    });
    const rows = await tokenRows({ ...context, requestVersionId }, [cancelRow(locale)]);
    return context.reply(locale, copy.newCategoryPrompt, context.request.id, rows.actionTokens, {
      actionRows: rows.actionRows,
    });
  }
  if (name === 'pick_wp_blog_image' && value === 'ai' && collect.collectionStep === 'choose_image')
    return advance(context, { ...draft, image: { source: 'ai' } });
  throw new DomainError(
    'conflict_error',
    'Request is not waiting for this WordPress blog step.',
  );
};

export const isWordpressBlogCollectionAction = (action: string): boolean =>
  /^(?:pick_wp_blog_mode|wp_blog_content_done|wp_blog_skip_excerpt|pick_wp_blog_category|wp_blog_new_category|pick_wp_blog_image)(?::|$)/u.test(
    action,
  );
