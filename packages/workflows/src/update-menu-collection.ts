import { v7 as uuidv7 } from 'uuid';

import {
  updateMenuInputSchema,
  type SupportedLocale,
  type TelegramReply,
  type UpdateMenuInput,
} from '@binflow/contracts';
import type { ProjectManifest } from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { updateMenuDefinition } from '@binflow/policies';
import {
  discoverMenuCtas,
  toggleMenuCtaSelection,
  buildVersionedMenuPdfPath,
  type MenuCtaCandidate,
  type OrbitypePageSnapshot,
} from '@binflow/menu';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  buildUpdateMenuPlanMessage,
  buildUpdateMenuSelectionMessage,
  parseUpdateMenuExecuteInput,
  resolveUpdateMenuProductionOrigin,
  updateMenuActionLabels,
  updateMenuGuidance,
  updateMenuNoCtasMessage,
  updateMenuPdfRejectedMessage,
  formatMenuToggleLabel,
} from './update-menu-ingress.js';

export type UpdateMenuPagesLoader = (input: Readonly<{
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

const selectedFromKeys = (
  discovered: readonly MenuCtaCandidate[],
  keys: readonly string[],
): readonly MenuCtaCandidate[] =>
  keys.flatMap((key) => {
    const match = discovered.find((cta) => cta.key === key);
    return match === undefined ? [] : [match];
  });

export const createUpdateMenuRequest = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  hasCapability: HasCapabilityFn;
  identity: ResolvedIdentity;
  reply: ReplyFn;
}>): Promise<TelegramReply> => {
  if (
    !(await input.hasCapability(input.database, input.identity.projectId, 'update_menu'))
  )
    return input.reply(input.identity.locale, updateMenuGuidance[input.identity.locale], null);

  const requestId = uuidv7();
  const requestVersionId = uuidv7();
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
    return input.reply(input.identity.locale, updateMenuGuidance[input.identity.locale], null);

  const interpretedInput = updateMenuInputSchema.parse({
    collectionStep: 'await_pdf',
    mode: 'collect',
    projectId: input.identity.projectId,
  });
  await input.database.insert(schema.requests).values({
    capabilityId: 'update_menu',
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT',
    tenantId: input.identity.tenantId,
    topic: 'Menu update',
    userId: input.identity.userId,
  });
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: updateMenuDefinition.version,
    id: requestVersionId,
    interpretedInput,
    manifestVersionId: manifestRow.id,
    plan: { collectionStep: 'await_pdf', nodes: ['await_pdf'] },
    projectId: input.identity.projectId,
    requestId,
    tenantId: input.identity.tenantId,
    version: 1,
  });
  return input.reply(
    input.identity.locale,
    updateMenuGuidance[input.identity.locale],
    requestId,
  );
};

export const continueUpdateMenuCollection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  documentArtifactKey?: string;
  identity: ResolvedIdentity;
  loadPages: UpdateMenuPagesLoader;
  menuCtaKeywords?: readonly string[];
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  text: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = updateMenuInputSchema.parse(input.version.interpretedInput);
  if (previous.mode !== 'collect')
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  const [manifestRow] = await input.database
    .select({
      document: schema.projectManifestVersions.document,
      id: schema.projectManifestVersions.id,
    })
    .from(schema.projectManifestVersions)
    .where(eq(schema.projectManifestVersions.id, input.version.manifestVersionId))
    .limit(1);
  if (manifestRow === undefined)
    return input.reply(input.identity.locale, 'Unknown request.', input.request.id);

  if (
    previous.collectionStep === 'await_pdf' &&
    input.documentArtifactKey !== undefined
  ) {
    const pages = await input.loadPages({
      database: input.database,
      manifest: manifestRow.document,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    });
    const discovered = discoverMenuCtas(
      pages,
      manifestRow.document.contentLocales,
      input.menuCtaKeywords ?? [],
    );
    if (discovered.length === 0)
      return input.reply(
        input.identity.locale,
        updateMenuNoCtasMessage[input.identity.locale],
        input.request.id,
      );
    const menuPdfPublicPath = buildVersionedMenuPdfPath(input.version.id);
    const interpretedInput = updateMenuInputSchema.parse({
      ...previous,
      collectionStep: 'select_ctas',
      discoveredCtas: discovered,
      menuPdfPublicPath,
      pdfArtifactKey: input.documentArtifactKey,
      pdfFileName: input.text.trim() || 'menu.pdf',
      selectedCtaKeys: discovered.map((cta) => cta.key),
    });
    const nextVersion = input.request.currentVersion + 1;
    const requestVersionId = uuidv7();
    await input.database
      .update(schema.requests)
      .set({ currentVersion: nextVersion, state: 'NEEDS_INPUT' })
      .where(eq(schema.requests.id, input.request.id));
    await input.database.insert(schema.requestVersions).values({
      capabilityVersion: updateMenuDefinition.version,
      id: requestVersionId,
      interpretedInput,
      manifestVersionId: manifestRow.id,
      plan: { collectionStep: 'select_ctas', nodes: ['select_menu_buttons'] },
      projectId: input.identity.projectId,
      requestId: input.request.id,
      tenantId: input.identity.tenantId,
      version: nextVersion,
    });
    const selected = selectedFromKeys(discovered, interpretedInput.selectedCtaKeys);
    const actionTokens: TelegramReply['actionTokens'] = [];
    for (const cta of discovered.slice(0, 8)) {
      actionTokens.push({
        action: 'toggle_menu_cta',
        label: formatMenuToggleLabel(
          cta,
          selected.some((entry) => entry.key === cta.key),
        ),
        token: await input.createAction(
          input.database,
          input.request,
          requestVersionId,
          input.identity.userId,
          `toggle_menu_cta:${cta.key}`,
        ),
      });
    }
    actionTokens.push({
      action: 'confirm_menu_selection',
      label: updateMenuActionLabels[input.identity.locale].confirmSelection,
      token: await input.createAction(
        input.database,
        input.request,
        requestVersionId,
        input.identity.userId,
        'confirm_menu_selection',
      ),
    });
    return input.reply(
      input.identity.locale,
      buildUpdateMenuSelectionMessage(
        input.identity.locale,
        selected,
        discovered,
      ),
      input.request.id,
      actionTokens,
    );
  }

  return input.reply(
    input.identity.locale,
    input.documentArtifactKey === undefined
      ? updateMenuPdfRejectedMessage[input.identity.locale]
      : updateMenuGuidance[input.identity.locale],
    input.request.id,
  );
};

export const consumeUpdateMenuToggle = async (input: Readonly<{
  ctaKey: string;
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = updateMenuInputSchema.parse(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'select_ctas')
    throw new Error('Update menu toggle is invalid for this request state.');
  const selectedKeys = toggleMenuCtaSelection(
    parsed.selectedCtaKeys,
    input.ctaKey,
  );
  const nextVersion = input.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  const interpretedInput = updateMenuInputSchema.parse({
    ...parsed,
    selectedCtaKeys: selectedKeys,
  });
  await input.database
    .update(schema.requests)
    .set({ currentVersion: nextVersion })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: updateMenuDefinition.version,
    id: requestVersionId,
    interpretedInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: input.version.plan,
    projectId: input.identity.projectId,
    requestId: input.request.id,
    tenantId: input.identity.tenantId,
    version: nextVersion,
  });
  const selected = selectedFromKeys(parsed.discoveredCtas, selectedKeys);
  const actionTokens: TelegramReply['actionTokens'] = [];
  for (const cta of parsed.discoveredCtas.slice(0, 8)) {
    actionTokens.push({
      action: 'toggle_menu_cta',
      label: formatMenuToggleLabel(
        cta,
        selected.some((entry) => entry.key === cta.key),
      ),
      token: await input.createAction(
        input.database,
        input.request,
        requestVersionId,
        input.identity.userId,
        `toggle_menu_cta:${cta.key}`,
      ),
    });
  }
  actionTokens.push({
    action: 'confirm_menu_selection',
    label: updateMenuActionLabels[input.identity.locale].confirmSelection,
    token: await input.createAction(
      input.database,
      input.request,
      requestVersionId,
      input.identity.userId,
      'confirm_menu_selection',
    ),
  });
  return input.reply(
    input.identity.locale,
    buildUpdateMenuSelectionMessage(
      input.identity.locale,
      selected,
      parsed.discoveredCtas,
    ),
    input.request.id,
    actionTokens,
  );
};

export const consumeUpdateMenuSelection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: ResolvedIdentity;
  manifest: ProjectManifest;
  manifestVersionId: string;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const parsed = updateMenuInputSchema.parse(input.version.interpretedInput);
  if (parsed.mode !== 'collect' || parsed.collectionStep !== 'select_ctas')
    throw new Error('Update menu selection confirm is invalid.');
  if (parsed.selectedCtaKeys.length === 0)
    return input.reply(
      input.identity.locale,
      updateMenuNoCtasMessage[input.identity.locale],
      input.request.id,
    );
  const selected = selectedFromKeys(parsed.discoveredCtas, parsed.selectedCtaKeys);
  const executeInput = parseUpdateMenuExecuteInput(
    input.identity.projectId,
    input.version.id,
    resolveUpdateMenuProductionOrigin(input.manifest),
    parsed,
  );
  const nextVersion = input.request.currentVersion + 1;
  const requestVersionId = uuidv7();
  await input.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'AWAITING_PLAN_CONFIRMATION',
      topic: `Menu · ${selected.length} buttons`,
    })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: updateMenuDefinition.version,
    id: requestVersionId,
    interpretedInput: executeInput,
    manifestVersionId: input.manifestVersionId,
    plan: {
      menuPdfPublicUrl: executeInput.menuPdfPublicUrl,
      nodes: ['plan_confirm'],
      selectedCtaCount: selected.length,
    },
    projectId: input.identity.projectId,
    requestId: input.request.id,
    tenantId: input.identity.tenantId,
    version: nextVersion,
  });
  const confirm = await input.createAction(
    input.database,
    input.request,
    requestVersionId,
    input.identity.userId,
    'confirm_plan',
  );
  const cancel = await input.createAction(
    input.database,
    input.request,
    requestVersionId,
    input.identity.userId,
    'cancel',
  );
  return input.reply(
    input.identity.locale,
    buildUpdateMenuPlanMessage(
      input.identity.locale,
      executeInput.menuPdfPublicUrl,
      selected,
    ),
    input.request.id,
    [
      {
        action: 'confirm_plan',
        label: updateMenuActionLabels[input.identity.locale].confirmPlan,
        token: confirm,
      },
      {
        action: 'cancel',
        label: 'Cancelar',
        token: cancel,
      },
    ],
  );
};

export const updateMenuNaturalLanguage = (text: string): boolean =>
  /\b(actualiz\w*\s+men[uú]|subir\s+(?:la\s+)?carta|menu\s+pdf|update\s+menu|upload\s+menu|speisekarte\s+aktualisieren|men[uü]\s+hochladen)\b/iu.test(
    text,
  );
