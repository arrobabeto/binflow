import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import {
  type SupportedLocale,
  type TelegramReply,
} from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

export const HEY_BINN_CAPABILITY_ID = 'hey_binn' as const;
/** Canonical Telegram command (underscore — valid for setMyCommands). */
export const HEY_BINN_COMMAND = '/hey_binn' as const;
/** Idle thread timeout — after this, free-text no longer routes to Binn. */
export const HEY_BINN_THREAD_TTL_MS = 10 * 60 * 1_000;
export const HEY_BINN_ACTION_TTL_MS = 10 * 60 * 1_000;
export const HEY_BINN_DEFAULT_MODEL = 'gpt-5.6-luna' as const;
/** Cap allowlisted inventory rows injected into the model context. */
export const HEY_BINN_INVENTORY_CAP = 80 as const;
/** Max characters of excerpt per inventory item. */
export const HEY_BINN_EXCERPT_CHARS = 1_200 as const;
/** Soft total budget for all excerpts in one turn. */
export const HEY_BINN_EXCERPT_TOTAL_CHARS = 40_000 as const;

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const actionToken = (): string => randomBytes(24).toString('base64url');

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

export type HeyBinnInventoryItem = Readonly<{
  category?: string;
  /** Truncated allowlisted body/page copy (optional). */
  excerpt?: string;
  kind: 'blog' | 'page' | 'portfolio' | 'surface';
  locale?: string;
  slug?: string;
  sourceId?: string;
  title: string;
}>;

export type HeyBinnSiteInventory = Readonly<{
  collections: ReadonlyArray<
    Readonly<{ directory: string; locale: string; routePrefix: string }>
  >;
  items: ReadonlyArray<HeyBinnInventoryItem>;
  notes: string;
  source: 'github' | 'github+cms' | 'cms' | 'manifest_only';
}>;

export type HeyBinnProjectContext = Readonly<{
  inventory: HeyBinnSiteInventory;
  profile: string;
  productionOrigin: string | null;
  repository: string | null;
  tenantKey: string;
}>;

export type HeyBinnSiteContextLoader = (
  input: Readonly<{
    database: ScopedDatabase;
    projectId: string;
    tenantId: string;
  }>,
) => Promise<HeyBinnSiteInventory>;

export type HeyBinnChatResult = Readonly<{
  askConfirmHandoff: boolean;
  estimatedCostCents: number;
  inputTokens: number;
  latencyMs: number;
  model: string;
  outputTokens: number;
  providerRequestId?: string;
  reply: string;
  suggestedToolCommand: string | null;
  typedHandoff: string | null;
}>;

export type HeyBinnChatPort = (
  input: Readonly<{
    enabledTools: ReadonlyArray<
      Readonly<{ command: string; displayName: string }>
    >;
    locale: SupportedLocale;
    message: string;
    projectContext: HeyBinnProjectContext;
    projectId: string;
    tenantId: string;
  }>,
) => Promise<HeyBinnChatResult>;

export type HeyBinnHandoffPayload = Readonly<{
  suggestedToolCommand: string;
  typedHandoff: string;
}>;

const copy = {
  de: {
    approveHandoff: 'Nachricht vorbereiten',
    cancelHandoff: 'Weiter chatten',
    farewell:
      'Tschüss! Die Binn-Unterhaltung ist beendet. Schreib /hey_binn, wenn du wieder Ideen brauchst.',
    handoffDelivered: (command: string, typed: string) =>
      `Hier ist deine vorbereitete Nachricht für ${command}. Starte das Tool selbst und füge sie ein:\n\n${typed}`,
    handoffPrompt: (command: string) =>
      `Ich kann eine fertige Nachricht für ${command} vorbereiten. Soll ich sie dir zeigen?`,
    missingGithub:
      'Binn kann dein Repo gerade nicht lesen (GitHub-Anbindung fehlt oder ist inaktiv). Bitte den Operator, die GitHub App zu prüfen.',
    missingOpenAi:
      'Binn ist gerade nicht verfügbar (OpenAI fehlt für dieses Projekt). Nutze /tools oder /open_ticket.',
    rejectHandoff:
      'Alles klar — wir bleiben im Chat. Frag weiter oder nutze /tools.',
    welcome:
      'Hallo, ich bin Binn. Ich lese dein Projekt (Blogs und Seiten-Copy) und helfe bei Ideen — ohne selbst etwas zu ändern. Beenden mit /bye_binn oder „Tschüss Binn“. Womit starten?',
  },
  en: {
    approveHandoff: 'Prepare message',
    cancelHandoff: 'Keep chatting',
    farewell:
      'Bye! Binn chat is closed. Use /hey_binn whenever you want ideas again.',
    handoffDelivered: (command: string, typed: string) =>
      `Here is your prepared message for ${command}. Start the tool yourself and paste it in:\n\n${typed}`,
    handoffPrompt: (command: string) =>
      `I can prepare a ready-to-paste message for ${command}. Want me to show it?`,
    missingGithub:
      'Binn cannot read your repo right now (GitHub binding missing or inactive). Ask the operator to verify the GitHub App.',
    missingOpenAi:
      'Binn is unavailable right now (OpenAI is missing for this project). Use /tools or /open_ticket.',
    rejectHandoff: 'Okay — staying in chat. Ask more or use /tools.',
    welcome:
      'Hi, I am Binn. I read your project (blog and page copy) and help with ideas — without changing anything myself. End with /bye_binn or “Bye Binn”. What should we work on?',
  },
  es: {
    approveHandoff: 'Preparar mensaje',
    cancelHandoff: 'Seguir chateando',
    farewell:
      '¡Hasta luego! La charla con Binn quedó cerrada. Usa /hey_binn cuando quieras ideas otra vez.',
    handoffDelivered: (command: string, typed: string) =>
      `Aquí tienes el mensaje preparado para ${command}. Tú activas la tool y lo pegas:\n\n${typed}`,
    handoffPrompt: (command: string) =>
      `Puedo preparar un mensaje listo para pegar en ${command}. ¿Lo muestro?`,
    missingGithub:
      'Binn no puede leer tu repo ahora (falta o está inactiva la conexión GitHub). Pide al operador revisar la GitHub App.',
    missingOpenAi:
      'Binn no está disponible ahora (falta OpenAI en este proyecto). Usa /tools o /open_ticket.',
    rejectHandoff: 'De acuerdo — seguimos en el chat. Pregunta más o usa /tools.',
    welcome:
      'Hola, soy Binn. Leo tu proyecto (copy de blogs y páginas) y ayudo con ideas — sin cambiar nada yo. Termina con /bye_binn o “Adiós Binn”. ¿En qué trabajamos?',
  },
} as const;

/** Explicit Binn address — must not steal plain tool intents or bare courtesy. */
const BINN_GREETING_RE =
  /^(?:hey\s+binn|hi\s+binn|hello\s+binn|hola\s+binn|hallo\s+binn|buen[oa]s?\s+(?:d[ií]as?\s+)?binn|guten\s+(?:tag|morgen|abend)\s+binn)(?:\s*[,!.?]+\s*([\s\S]{0,4000}))?$/iu;

const BINN_COMMAND_RE =
  /^\/hey[_-]binn(?:@\w+)?(?:\s+([\s\S]{1,4000}))?$/iu;

const BINN_BYE_COMMAND_RE = /^\/bye[_-]binn(?:@\w+)?$/iu;

/** Explicit goodbye addressed to Binn — not bare thanks/hola. */
const BINN_EXIT_NL_RE =
  /^(?:(?:adi[oó]s|adios|bye|goodbye|ciao|hasta\s+luego|tsch[uü]ss|auf\s+wiedersehen|danke|gracias|thanks(?:\s+you)?|thank\s+you)\s+binn)[\s!.?]*$/iu;

export const matchHeyBinnCommand = (
  text: string,
): { kind: 'command'; seed: string } | null => {
  const match = BINN_COMMAND_RE.exec(text.trim());
  if (match === null) return null;
  return { kind: 'command', seed: (match[1] ?? '').trim() };
};

export const matchHeyBinnGreeting = (
  text: string,
): { kind: 'greeting'; seed: string } | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 4_080) return null;
  if (trimmed.startsWith('/')) return null;
  const match = BINN_GREETING_RE.exec(trimmed);
  if (match === null) return null;
  return { kind: 'greeting', seed: (match[1] ?? '').trim() };
};

export const matchHeyBinnExit = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 120) return false;
  if (BINN_BYE_COMMAND_RE.test(trimmed)) return true;
  if (trimmed.startsWith('/')) return false;
  return BINN_EXIT_NL_RE.test(trimmed);
};

export const isHeyBinnIngress = (text: string): boolean =>
  matchHeyBinnCommand(text) !== null ||
  matchHeyBinnGreeting(text) !== null ||
  matchHeyBinnExit(text);

/**
 * Free-text claims that must beat tool natural-language matchers in
 * `WorkflowService.route`. Slash tool commands are never claimed (escape hatch).
 */
export type HeyBinnFreeTextClaim =
  | { kind: 'greeting'; seed: string }
  | { kind: 'exit' }
  | { kind: 'active_thread'; message: string };

export const claimHeyBinnFreeTextRoute = (input: {
  hasActiveThread: boolean;
  text: string;
}): HeyBinnFreeTextClaim | null => {
  const text = input.text;
  if (matchHeyBinnExit(text)) return { kind: 'exit' };
  const greeting = matchHeyBinnGreeting(text);
  if (greeting !== null) return { kind: 'greeting', seed: greeting.seed };
  const trimmed = text.trim();
  if (
    !text.startsWith('/') &&
    trimmed.length > 0 &&
    trimmed.length <= 4_000 &&
    input.hasActiveThread
  ) {
    return { kind: 'active_thread', message: trimmed };
  }
  return null;
};

/** Deterministic owner when Binn free-text competes with tool NL. */
export const resolveFreeTextRouteOwner = (input: {
  hasActiveHeyBinnThread: boolean;
  text: string;
  toolNaturalLanguageMatches: boolean;
}): 'hey_binn' | 'tool_nl' | 'unclaimed' => {
  if (
    claimHeyBinnFreeTextRoute({
      hasActiveThread: input.hasActiveHeyBinnThread,
      text: input.text,
    }) !== null
  ) {
    return 'hey_binn';
  }
  if (input.toolNaturalLanguageMatches) return 'tool_nl';
  return 'unclaimed';
};

/** Strip YAML frontmatter from markdown; return body text. */
export const stripMarkdownFrontmatter = (raw: string): string => {
  const trimmed = raw.replace(/^\uFEFF/u, '');
  if (!trimmed.startsWith('---')) return trimmed.trim();
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return trimmed.trim();
  const after = trimmed.slice(end + '\n---'.length).replace(/^\r?\n/u, '');
  return after.trim();
};

export const truncateHeyBinnExcerpt = (
  value: string,
  maxChars: number = HEY_BINN_EXCERPT_CHARS,
): string => {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

export const allocateHeyBinnExcerpt = (input: Readonly<{
  budgetRemaining: number;
  text: string;
  maxPerItem?: number;
}>): { excerpt: string | undefined; spent: number } => {
  if (input.budgetRemaining <= 0) return { excerpt: undefined, spent: 0 };
  const maxPerItem = input.maxPerItem ?? HEY_BINN_EXCERPT_CHARS;
  const capped = truncateHeyBinnExcerpt(
    input.text,
    Math.min(maxPerItem, input.budgetRemaining),
  );
  if (capped.length === 0) return { excerpt: undefined, spent: 0 };
  return { excerpt: capped, spent: capped.length };
};

const touchThread = async (input: Readonly<{
  database: ScopedDatabase;
  identity: Identity;
  now: Date;
}>): Promise<void> => {
  await input.database
    .insert(schema.binnThreads)
    .values({
      conversationId: input.identity.conversationId,
      createdAt: input.now,
      lastActivityAt: input.now,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
    })
    .onConflictDoUpdate({
      set: { lastActivityAt: input.now },
      target: schema.binnThreads.conversationId,
    });
};

export const clearHeyBinnThread = async (input: Readonly<{
  conversationId: string;
  database: ScopedDatabase;
}>): Promise<void> => {
  await input.database
    .delete(schema.binnThreads)
    .where(eq(schema.binnThreads.conversationId, input.conversationId));
};

export const hasActiveHeyBinnThread = async (input: Readonly<{
  conversationId: string;
  database: ScopedDatabase;
  now: Date;
  ttlMs?: number;
}>): Promise<boolean> => {
  const ttl = input.ttlMs ?? HEY_BINN_THREAD_TTL_MS;
  const [row] = await input.database
    .select({ lastActivityAt: schema.binnThreads.lastActivityAt })
    .from(schema.binnThreads)
    .where(eq(schema.binnThreads.conversationId, input.conversationId))
    .limit(1);
  if (row === undefined) return false;
  if (input.now.getTime() - row.lastActivityAt.getTime() > ttl) {
    await clearHeyBinnThread({
      conversationId: input.conversationId,
      database: input.database,
    });
    return false;
  }
  return true;
};

const recordUsage = async (input: Readonly<{
  database: ScopedDatabase;
  identity: Identity;
  result: Pick<
    HeyBinnChatResult,
    | 'estimatedCostCents'
    | 'inputTokens'
    | 'latencyMs'
    | 'model'
    | 'outputTokens'
    | 'providerRequestId'
  >;
  status: 'ok' | 'error';
}>): Promise<void> => {
  await input.database.insert(schema.binnUsageEvents).values({
    capabilityId: HEY_BINN_CAPABILITY_ID,
    estimatedCostCents: input.result.estimatedCostCents,
    id: uuidv7(),
    inputTokens: input.result.inputTokens,
    latencyMs: input.result.latencyMs,
    model: input.result.model,
    outputTokens: input.result.outputTokens,
    projectId: input.identity.projectId,
    provider: 'openai',
    ...(input.result.providerRequestId === undefined
      ? {}
      : { providerRequestId: input.result.providerRequestId }),
    status: input.status,
    tenantId: input.identity.tenantId,
  });
};

const createBinnAction = async (input: Readonly<{
  action: 'confirm_binn_handoff' | 'cancel_binn_handoff';
  database: ScopedDatabase;
  expiresAt: Date;
  identity: Identity;
  payload: Record<string, unknown>;
}>): Promise<string> => {
  const token = actionToken();
  await input.database.insert(schema.binnActions).values({
    action: input.action,
    conversationId: input.identity.conversationId,
    expiresAt: input.expiresAt,
    id: uuidv7(),
    payload: input.payload,
    projectId: input.identity.projectId,
    tenantId: input.identity.tenantId,
    tokenHash: digest(token),
    userId: input.identity.userId,
  });
  return token;
};

const loadProjectContext = async (
  database: ScopedDatabase,
  projectId: string,
  tenantId: string,
  loadSiteContext: HeyBinnSiteContextLoader | undefined,
): Promise<HeyBinnProjectContext | null> => {
  const [manifest] = await database
    .select({
      document: schema.projectManifestVersions.document,
      profile: schema.projectManifestVersions.profile,
    })
    .from(schema.projectManifestVersions)
    .where(
      and(
        eq(schema.projectManifestVersions.projectId, projectId),
        eq(schema.projectManifestVersions.tenantId, tenantId),
        inArray(schema.projectManifestVersions.status, [
          'validated',
          'active',
        ]),
      ),
    )
    .orderBy(desc(schema.projectManifestVersions.version))
    .limit(1);
  if (manifest === undefined) return null;
  const repository = `${manifest.document.repository.owner}/${manifest.document.repository.name}`;
  if (repository.length < 3) return null;
  const [tenant] = await database
    .select({ key: schema.tenants.key })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  const collections = Object.entries(manifest.document.content.collections).flatMap(
    ([locale, collection]) =>
      collection === undefined
        ? []
        : [
            {
              directory: collection.directory,
              locale,
              routePrefix: collection.routePrefix,
            },
          ],
  );

  let inventory: HeyBinnSiteInventory = {
    collections,
    items: [],
    notes:
      'No live site inventory loader configured; only manifest collections are available.',
    source: 'manifest_only',
  };
  if (loadSiteContext !== undefined) {
    inventory = await loadSiteContext({
      database,
      projectId,
      tenantId,
    });
  }

  return {
    inventory,
    profile: manifest.profile,
    productionOrigin: manifest.document.deployment.productionOrigin ?? null,
    repository,
    tenantKey: tenant?.key ?? 'unknown',
  };
};

export const endHeyBinnConversation = async (input: Readonly<{
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
}>): Promise<TelegramReply> => {
  await clearHeyBinnThread({
    conversationId: input.identity.conversationId,
    database: input.database,
  });
  return input.reply(
    input.identity.locale,
    copy[input.identity.locale].farewell,
    null,
  );
};

export const runHeyBinnTurn = async (input: Readonly<{
  chat: HeyBinnChatPort;
  database: ScopedDatabase;
  enabledTools: ReadonlyArray<
    Readonly<{ command: string; displayName: string }>
  >;
  identity: Identity;
  loadSiteContext?: HeyBinnSiteContextLoader;
  message: string;
  now: Date;
  reply: ReplyFn;
  welcomeOnly?: boolean;
}>): Promise<TelegramReply> => {
  const labels = copy[input.identity.locale];
  await touchThread({
    database: input.database,
    identity: input.identity,
    now: input.now,
  });

  if (input.welcomeOnly === true && input.message.trim().length === 0)
    return input.reply(input.identity.locale, labels.welcome, null);

  let projectContext: HeyBinnProjectContext | null;
  try {
    projectContext = await loadProjectContext(
      input.database,
      input.identity.projectId,
      input.identity.tenantId,
      input.loadSiteContext,
    );
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.category === 'credential_unavailable' ||
        error.category === 'authentication_error' ||
        error.category === 'authorization_error' ||
        error.category === 'provider_final' ||
        error.category === 'provider_retryable')
    )
      return input.reply(input.identity.locale, labels.missingGithub, null);
    throw error;
  }
  if (projectContext === null)
    throw new DomainError(
      'policy_denied',
      'Hey Binn requires an active project binding with a readable repository.',
      { code: 'hey_binn_context_unavailable' },
    );

  const toolsForModel = [
    ...input.enabledTools.map((item) => ({
      command: item.command,
      displayName: item.displayName,
    })),
    {
      command: '/open_ticket',
      displayName:
        input.identity.locale === 'es'
          ? 'Petición personalizada'
          : input.identity.locale === 'de'
            ? 'Individuelle Anfrage'
            : 'Custom request',
    },
  ];

  let result: HeyBinnChatResult;
  try {
    result = await input.chat({
      enabledTools: toolsForModel,
      locale: input.identity.locale,
      message:
        input.message.trim().length > 0 ? input.message.trim() : labels.welcome,
      projectContext,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    });
  } catch (error) {
    if (
      error instanceof DomainError &&
      (error.category === 'authentication_error' ||
        error.category === 'authorization_error' ||
        error.category === 'credential_unavailable' ||
        error.category === 'provider_final' ||
        error.category === 'provider_retryable')
    )
      return input.reply(input.identity.locale, labels.missingOpenAi, null);
    throw error;
  }

  await recordUsage({
    database: input.database,
    identity: input.identity,
    result,
    status: 'ok',
  });

  const allowedCommands = new Set(
    toolsForModel.map((item) => item.command.toLowerCase()),
  );
  const suggested =
    result.suggestedToolCommand === null
      ? null
      : result.suggestedToolCommand.startsWith('/')
        ? result.suggestedToolCommand
        : `/${result.suggestedToolCommand.replace(/^\//u, '')}`;
  const canHandoff =
    result.askConfirmHandoff &&
    suggested !== null &&
    allowedCommands.has(suggested.toLowerCase()) &&
    result.typedHandoff !== null &&
    result.typedHandoff.trim().length > 0;

  if (!canHandoff)
    return input.reply(input.identity.locale, result.reply, null);

  const expiresAt = new Date(input.now.getTime() + HEY_BINN_ACTION_TTL_MS);
  const payload: HeyBinnHandoffPayload = {
    suggestedToolCommand: suggested!,
    typedHandoff: result.typedHandoff!.trim(),
  };
  const confirmToken = await createBinnAction({
    action: 'confirm_binn_handoff',
    database: input.database,
    expiresAt,
    identity: input.identity,
    payload,
  });
  const cancelToken = await createBinnAction({
    action: 'cancel_binn_handoff',
    database: input.database,
    expiresAt,
    identity: input.identity,
    payload: {},
  });
  const text = `${result.reply}\n\n${labels.handoffPrompt(suggested!)}`;
  return input.reply(input.identity.locale, text, null, [
    {
      action: 'confirm_binn_handoff',
      label: labels.approveHandoff,
      token: confirmToken,
    },
    {
      action: 'cancel_binn_handoff',
      label: labels.cancelHandoff,
      token: cancelToken,
    },
  ]);
};

export const consumeHeyBinnAction = async (input: Readonly<{
  database: ScopedDatabase;
  identity: Identity;
  now: Date;
  reply: ReplyFn;
  token: string;
}>): Promise<TelegramReply | null> => {
  const [action] = await input.database
    .select()
    .from(schema.binnActions)
    .where(
      and(
        eq(schema.binnActions.tokenHash, digest(input.token)),
        eq(schema.binnActions.userId, input.identity.userId),
        isNull(schema.binnActions.consumedAt),
        isNull(schema.binnActions.revokedAt),
        gt(schema.binnActions.expiresAt, input.now),
      ),
    )
    .limit(1);
  if (action === undefined) return null;

  await input.database
    .update(schema.binnActions)
    .set({ consumedAt: input.now })
    .where(eq(schema.binnActions.id, action.id));

  const labels = copy[input.identity.locale];
  await touchThread({
    database: input.database,
    identity: input.identity,
    now: input.now,
  });

  if (action.action === 'cancel_binn_handoff')
    return input.reply(input.identity.locale, labels.rejectHandoff, null);

  if (action.action === 'confirm_binn_handoff') {
    const payload = action.payload as Partial<HeyBinnHandoffPayload>;
    if (
      typeof payload.suggestedToolCommand !== 'string' ||
      typeof payload.typedHandoff !== 'string'
    )
      throw new DomainError(
        'conflict_error',
        'Hey Binn handoff payload is invalid.',
      );
    return input.reply(
      input.identity.locale,
      labels.handoffDelivered(
        payload.suggestedToolCommand,
        payload.typedHandoff,
      ),
      null,
    );
  }

  throw new DomainError('conflict_error', 'Unknown Hey Binn action.');
};

export const heyBinnMissingOpenAiReply = (
  locale: SupportedLocale,
): string => copy[locale].missingOpenAi;
