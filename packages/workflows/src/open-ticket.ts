import { v7 as uuidv7 } from 'uuid';

import {
  openTicketCollectInputSchema,
  type OpenTicketCollectInput,
  type SupportedLocale,
  type TelegramReply,
} from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';
import { DomainError } from '@binflow/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';

export const OPEN_TICKET_CAPABILITY_ID = 'open_ticket' as const;

export type TicketKind = 'improvement' | 'style' | 'bug';
export type TicketUrgency = 'low' | 'normal' | 'high' | 'urgent';

export type OpenTicketCollect = OpenTicketCollectInput;

export type TicketEstimateResult = Readonly<{
  effortEstimate: string;
  summary: string;
  title: string;
}>;

export type TicketEstimatePort = (
  input: Readonly<{
    intent: string;
    kind: TicketKind;
    locale: SupportedLocale;
    projectId: string;
    requirement: string;
    scope: string;
    tenantId: string;
    urgency: TicketUrgency;
  }>,
) => Promise<TicketEstimateResult>;

export const ticketPriorityFromUrgency = (
  urgency: TicketUrgency,
): 'low' | 'medium' | 'high' => {
  if (urgency === 'low') return 'low';
  if (urgency === 'normal') return 'medium';
  return 'high';
};

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
  request: Pick<
    typeof schema.requests.$inferSelect,
    'id' | 'projectId' | 'tenantId'
  >,
  requestVersionId: string,
  userId: string,
  action: string,
) => Promise<string>;

const copy = {
  de: {
    cancel: 'Abbrechen',
    choice:
      'Deine Anfrage passt zu keiner verfügbaren Tool. Möchtest du eine individuelle Anfrage stellen oder die Tools ansehen?',
    confirmSend: 'Ticket senden',
    customRequest: 'Individuelle Anfrage',
    greeting:
      'Hallo! Schön, von dir zu hören. Sag Bescheid, wenn ich mit /tools oder /open_ticket helfen kann.',
    intentPrompt: 'Was schwebt dir vor? Beschreibe die Idee in eigenen Worten.',
    kindBug: 'Fehler',
    kindImprovement: 'Verbesserung',
    kindPrompt: 'Was für eine Anfrage ist das?',
    kindStyle: 'Stil / Design',
    requirementPrompt:
      'Was brauchst du genau? Beschreibe die Anforderung möglichst klar.',
    scopePrompt:
      'Welchen Umfang soll die Änderung haben? (Seiten, Bereiche, Grenzen)',
    seeTools: 'Tools ansehen',
    sent: (publicId: string) =>
      `Ticket ${publicId} wurde an das Admin-Team gesendet. Wir melden uns.`,
    summaryHeader: 'Zusammenfassung deiner Anfrage:',
    thanks: 'Gerne! Wenn du etwas brauchst, nutze /tools oder /open_ticket.',
    urgencyHigh: 'Hoch',
    urgencyLow: 'Niedrig',
    urgencyNormal: 'Normal',
    urgencyPrompt: 'Wie dringend ist das?',
    urgencyUrgent: 'Dringend',
  },
  en: {
    cancel: 'Cancel',
    choice:
      'I could not match that to an available tool. Do you want to open a custom request, or see the available tools?',
    confirmSend: 'Send ticket',
    customRequest: 'Custom request',
    greeting:
      'Hi! Good to hear from you. Use /tools or /open_ticket whenever you need help.',
    intentPrompt: 'What do you have in mind? Describe the idea in your own words.',
    kindBug: 'Bug / error',
    kindImprovement: 'Improvement',
    kindPrompt: 'What kind of request is this?',
    kindStyle: 'Style / design',
    requirementPrompt:
      'What do you need exactly? Describe the requirement as clearly as you can.',
    scopePrompt: 'What is the scope? (pages, areas, boundaries)',
    seeTools: 'See tools',
    sent: (publicId: string) =>
      `Ticket ${publicId} was sent to the admin team. We will follow up.`,
    summaryHeader: 'Summary of your request:',
    thanks: 'You are welcome! Use /tools or /open_ticket anytime you need something.',
    urgencyHigh: 'High',
    urgencyLow: 'Low',
    urgencyNormal: 'Normal',
    urgencyPrompt: 'How urgent is this?',
    urgencyUrgent: 'Urgent',
  },
  es: {
    cancel: 'Cancelar',
    choice:
      'No pude identificar tu solicitud dentro de las herramientas disponibles. ¿Quieres hacer una petición personalizada o ver las tools disponibles?',
    confirmSend: 'Enviar ticket',
    customRequest: 'Petición personalizada',
    greeting:
      '¡Hola! Qué gusto saludarte. Cuando quieras, usa /tools o /open_ticket.',
    intentPrompt: '¿Qué tienes en mente? Cuéntalo con tus palabras.',
    kindBug: 'Error',
    kindImprovement: 'Mejora',
    kindPrompt: '¿Qué tipo de petición es?',
    kindStyle: 'Estilo / diseño',
    requirementPrompt:
      '¿Qué necesitas exactamente? Describe el requerimiento con claridad.',
    scopePrompt: '¿Cuál es el alcance? (páginas, áreas, límites)',
    seeTools: 'Ver tools',
    sent: (publicId: string) =>
      `Ticket ${publicId} enviado al equipo admin. Te contactaremos.`,
    summaryHeader: 'Resumen de tu petición:',
    thanks: '¡Con gusto! Cuando necesites algo, usa /tools o /open_ticket.',
    urgencyHigh: 'Alta',
    urgencyLow: 'Baja',
    urgencyNormal: 'Normal',
    urgencyPrompt: '¿Qué tan urgente es?',
    urgencyUrgent: 'Urgente',
  },
} as const;

const GREETING_RE =
  /^(hola|buenas|buen[oa]s?\s+d[ií]as?|hey|hi|hello|hallo|guten\s+(tag|morgen|abend)|¡?hola!?)[\s!.?]*$/iu;

const THANKS_RE =
  /^(gracias(?:\s+mil)?|muchas\s+gracias|thank(?:s| you)(?:\s+so\s+much)?|danke(?:\s+sch[oö]n)?|viel\s+dank)[\s!.?]*$/iu;

export const matchConversationalCourtesy = (
  text: string,
): 'greeting' | 'thanks' | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  if (trimmed.startsWith('/')) return null;
  if (THANKS_RE.test(trimmed)) return 'thanks';
  if (GREETING_RE.test(trimmed)) return 'greeting';
  return null;
};

export const conversationalCourtesyReply = (
  locale: SupportedLocale,
  kind: 'greeting' | 'thanks',
): string => (kind === 'thanks' ? copy[locale].thanks : copy[locale].greeting);

const parseCollect = (value: unknown): OpenTicketCollect =>
  openTicketCollectInputSchema.parse(value);

const loadManifestId = async (
  database: ScopedDatabase,
  projectId: string,
): Promise<string | undefined> => {
  const [row] = await database
    .select({ id: schema.projectManifestVersions.id })
    .from(schema.projectManifestVersions)
    .where(
      and(
        eq(schema.projectManifestVersions.projectId, projectId),
        inArray(schema.projectManifestVersions.status, [
          'validated',
          'active',
        ]),
      ),
    )
    .orderBy(desc(schema.projectManifestVersions.version))
    .limit(1);
  return row?.id;
};

const persist = async (input: Readonly<{
  database: ScopedDatabase;
  interpretedInput: OpenTicketCollect;
  plan: Record<string, unknown>;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<string> => {
  const nextVersion = input.request.currentVersion + 1;
  const id = uuidv7();
  await input.database
    .update(schema.requests)
    .set({
      currentVersion: nextVersion,
      state: 'NEEDS_INPUT',
      updatedAt: new Date(),
      version: input.request.version + 1,
    })
    .where(eq(schema.requests.id, input.request.id));
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: 1,
    id,
    interpretedInput: input.interpretedInput,
    manifestVersionId: input.version.manifestVersionId,
    plan: input.plan,
    projectId: input.request.projectId,
    requestId: input.request.id,
    tenantId: input.request.tenantId,
    version: nextVersion,
  });
  return id;
};

const urgencyTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const labels = copy[input.identity.locale];
  const items = [
    ['low', labels.urgencyLow],
    ['normal', labels.urgencyNormal],
    ['high', labels.urgencyHigh],
    ['urgent', labels.urgencyUrgent],
  ] as const;
  return Promise.all(
    items.map(async ([value, label]) => ({
      action: 'pick_ticket_urgency' as const,
      label,
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        `pick_ticket_urgency:${value}`,
      ),
    })),
  );
};

const kindTokens = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  request: typeof schema.requests.$inferSelect;
  requestVersionId: string;
}>): Promise<TelegramReply['actionTokens']> => {
  const labels = copy[input.identity.locale];
  const items = [
    ['improvement', labels.kindImprovement],
    ['style', labels.kindStyle],
    ['bug', labels.kindBug],
  ] as const;
  return Promise.all(
    items.map(async ([value, label]) => ({
      action: 'pick_ticket_kind' as const,
      label,
      token: await input.createAction(
        input.database,
        input.request,
        input.requestVersionId,
        input.identity.userId,
        `pick_ticket_kind:${value}`,
      ),
    })),
  );
};

const createShell = async (input: Readonly<{
  database: ScopedDatabase;
  identity: Identity;
  interpretedInput: OpenTicketCollect;
  topic: string;
}>): Promise<Readonly<{ requestId: string; requestVersionId: string }>> => {
  const manifestVersionId = await loadManifestId(
    input.database,
    input.identity.projectId,
  );
  if (manifestVersionId === undefined)
    throw new DomainError(
      'validation_error',
      'Active project manifest is required to open a ticket.',
    );
  const requestId = uuidv7();
  const requestVersionId = uuidv7();
  await input.database.insert(schema.requests).values({
    capabilityId: OPEN_TICKET_CAPABILITY_ID,
    conversationId: input.identity.conversationId,
    currentVersion: 1,
    id: requestId,
    projectId: input.identity.projectId,
    state: 'NEEDS_INPUT',
    tenantId: input.identity.tenantId,
    topic: input.topic,
    userId: input.identity.userId,
  });
  await input.database.insert(schema.requestVersions).values({
    capabilityVersion: 1,
    id: requestVersionId,
    interpretedInput: input.interpretedInput,
    manifestVersionId,
    plan: {
      collectionStep: input.interpretedInput.collectionStep,
      nodes: [input.interpretedInput.collectionStep],
    },
    projectId: input.identity.projectId,
    requestId,
    tenantId: input.identity.tenantId,
    version: 1,
  });
  return { requestId, requestVersionId };
};

export const createOpenTicketChoice = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  seedText?: string;
}>): Promise<TelegramReply> => {
  const interpretedInput = parseCollect({
    collectionStep: 'await_choice',
    mode: 'open_ticket_collect',
    projectId: input.identity.projectId,
    ...(input.seedText !== undefined && input.seedText.trim().length > 0
      ? { seedText: input.seedText.trim().slice(0, 4_000) }
      : {}),
  });
  const { requestId, requestVersionId } = await createShell({
    database: input.database,
    identity: input.identity,
    interpretedInput,
    topic: 'Custom request',
  });
  const labels = copy[input.identity.locale];
  const custom = await input.createAction(
    input.database,
    {
      id: requestId,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    },
    requestVersionId,
    input.identity.userId,
    'start_open_ticket',
  );
  const tools = await input.createAction(
    input.database,
    {
      id: requestId,
      projectId: input.identity.projectId,
      tenantId: input.identity.tenantId,
    },
    requestVersionId,
    input.identity.userId,
    'show_tools',
  );
  return input.reply(input.identity.locale, labels.choice, requestId, [
    { action: 'start_open_ticket', label: labels.customRequest, token: custom },
    { action: 'show_tools', label: labels.seeTools, token: tools },
  ]);
};

export const createOpenTicketInterview = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  seedText?: string;
}>): Promise<TelegramReply> => {
  const seed = input.seedText?.trim();
  const interpretedInput = parseCollect({
    collectionStep:
      seed && seed.length > 0 ? 'await_scope' : 'await_requirement',
    mode: 'open_ticket_collect',
    projectId: input.identity.projectId,
    ...(seed && seed.length > 0
      ? { requirement: seed.slice(0, 4_000), seedText: seed.slice(0, 4_000) }
      : {}),
  });
  const { requestId } = await createShell({
    database: input.database,
    identity: input.identity,
    interpretedInput,
    topic: 'Custom request',
  });
  const labels = copy[input.identity.locale];
  return input.reply(
    input.identity.locale,
    interpretedInput.collectionStep === 'await_scope'
      ? labels.scopePrompt
      : labels.requirementPrompt,
    requestId,
  );
};

export const continueOpenTicketCollection = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  text: string;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseCollect(input.version.interpretedInput);
  const labels = copy[input.identity.locale];
  const text = input.text.trim();
  if (text.length === 0)
    return input.reply(
      input.identity.locale,
      labels.requirementPrompt,
      input.request.id,
    );

  if (previous.collectionStep === 'await_requirement') {
    const next = parseCollect({
      ...previous,
      collectionStep: 'await_scope',
      requirement: text.slice(0, 4_000),
    });
    await persist({
      database: input.database,
      interpretedInput: next,
      plan: { collectionStep: 'await_scope', nodes: ['await_scope'] },
      request: input.request,
      version: input.version,
    });
    return input.reply(
      input.identity.locale,
      labels.scopePrompt,
      input.request.id,
    );
  }

  if (previous.collectionStep === 'await_scope') {
    const next = parseCollect({
      ...previous,
      collectionStep: 'await_intent',
      scope: text.slice(0, 4_000),
    });
    await persist({
      database: input.database,
      interpretedInput: next,
      plan: { collectionStep: 'await_intent', nodes: ['await_intent'] },
      request: input.request,
      version: input.version,
    });
    return input.reply(
      input.identity.locale,
      labels.intentPrompt,
      input.request.id,
    );
  }

  if (previous.collectionStep === 'await_intent') {
    const next = parseCollect({
      ...previous,
      collectionStep: 'await_urgency',
      intent: text.slice(0, 4_000),
    });
    const id = await persist({
      database: input.database,
      interpretedInput: next,
      plan: { collectionStep: 'await_urgency', nodes: ['await_urgency'] },
      request: input.request,
      version: input.version,
    });
    return input.reply(
      input.identity.locale,
      labels.urgencyPrompt,
      input.request.id,
      await urgencyTokens({ ...input, requestVersionId: id }),
    );
  }

  return input.reply(input.identity.locale, labels.choice, input.request.id);
};

export const consumeOpenTicketStart = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseCollect(input.version.interpretedInput);
  const labels = copy[input.identity.locale];
  const seed = previous.seedText?.trim();
  const next = parseCollect({
    ...previous,
    collectionStep:
      seed && seed.length > 0 ? 'await_scope' : 'await_requirement',
    ...(seed && seed.length > 0 ? { requirement: seed } : {}),
  });
  await persist({
    database: input.database,
    interpretedInput: next,
    plan: {
      collectionStep: next.collectionStep,
      nodes: [next.collectionStep],
    },
    request: input.request,
    version: input.version,
  });
  return input.reply(
    input.identity.locale,
    next.collectionStep === 'await_scope'
      ? labels.scopePrompt
      : labels.requirementPrompt,
    input.request.id,
  );
};

export const consumeOpenTicketUrgency = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  identity: Identity;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  urgency: TicketUrgency;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseCollect(input.version.interpretedInput);
  const labels = copy[input.identity.locale];
  const next = parseCollect({
    ...previous,
    collectionStep: 'await_kind',
    urgency: input.urgency,
  });
  const id = await persist({
    database: input.database,
    interpretedInput: next,
    plan: { collectionStep: 'await_kind', nodes: ['await_kind'] },
    request: input.request,
    version: input.version,
  });
  return input.reply(
    input.identity.locale,
    labels.kindPrompt,
    input.request.id,
    await kindTokens({ ...input, requestVersionId: id }),
  );
};

export const consumeOpenTicketKind = async (input: Readonly<{
  createAction: CreateActionFn;
  database: ScopedDatabase;
  estimate: TicketEstimatePort;
  identity: Identity;
  kind: TicketKind;
  reply: ReplyFn;
  request: typeof schema.requests.$inferSelect;
  version: typeof schema.requestVersions.$inferSelect;
}>): Promise<TelegramReply> => {
  const previous = parseCollect(input.version.interpretedInput);
  const labels = copy[input.identity.locale];
  if (
    previous.requirement === undefined ||
    previous.scope === undefined ||
    previous.intent === undefined ||
    previous.urgency === undefined
  )
    throw new DomainError(
      'validation_error',
      'Open ticket interview is incomplete.',
    );

  const estimated = await input.estimate({
    intent: previous.intent,
    kind: input.kind,
    locale: input.identity.locale,
    projectId: input.identity.projectId,
    requirement: previous.requirement,
    scope: previous.scope,
    tenantId: input.identity.tenantId,
    urgency: previous.urgency,
  });
  const next = parseCollect({
    ...previous,
    collectionStep: 'await_confirm',
    effortEstimate: estimated.effortEstimate,
    kind: input.kind,
    summary: estimated.summary,
    title: estimated.title.slice(0, 240),
  });
  const id = await persist({
    database: input.database,
    interpretedInput: next,
    plan: { collectionStep: 'await_confirm', nodes: ['await_confirm'] },
    request: input.request,
    version: input.version,
  });
  const send = await input.createAction(
    input.database,
    input.request,
    id,
    input.identity.userId,
    'confirm_ticket_send',
  );
  const cancel = await input.createAction(
    input.database,
    input.request,
    id,
    input.identity.userId,
    'cancel',
  );
  const body = [
    labels.summaryHeader,
    '',
    estimated.title,
    '',
    estimated.summary,
    '',
    estimated.effortEstimate,
  ].join('\n');
  return input.reply(input.identity.locale, body, input.request.id, [
    { action: 'confirm_ticket_send', label: labels.confirmSend, token: send },
    { action: 'cancel', label: labels.cancel, token: cancel },
  ]);
};

export const openTicketSentMessage = (
  locale: SupportedLocale,
  publicId: string,
): string => copy[locale].sent(publicId);

export const buildTicketBody = (collect: OpenTicketCollect): string => {
  const lines = [
    collect.summary ?? '',
    '',
    `Requirement: ${collect.requirement ?? ''}`,
    `Scope: ${collect.scope ?? ''}`,
    `Intent: ${collect.intent ?? ''}`,
    `Urgency: ${collect.urgency ?? ''}`,
    `Kind: ${collect.kind ?? ''}`,
    '',
    collect.effortEstimate ?? '',
  ];
  return lines.join('\n').trim();
};

export const enqueueAdminTicketCreatedNotice = async (
  database: ScopedDatabase,
  input: Readonly<{
    clientLabel: string;
    eventVersion: number;
    projectId: string;
    publicId: string;
    tenantId: string;
    ticketId: string;
    title: string;
  }>,
): Promise<void> => {
  const message = [
    `New ticket ${input.publicId}`,
    `Client: ${input.clientLabel}`,
    `Title: ${input.title}`,
    'Open Tickets in the dashboard to review.',
  ].join('\n');
  await database.insert(schema.outboxEvents).values({
    aggregateId: input.ticketId,
    aggregateType: 'ticket',
    eventType: 'admin.notification_requested',
    eventVersion: input.eventVersion,
    id: uuidv7(),
    jobKey: `admin.notification:ticket_created:${input.ticketId}:1`,
    payload: {
      message,
      notificationType: 'admin_ticket_created',
      ticketId: input.ticketId,
    },
    projectId: input.projectId,
    tenantId: input.tenantId,
  });
};

export const fallbackTicketEstimate = (
  input: Readonly<{
    intent: string;
    kind: TicketKind;
    locale: SupportedLocale;
    requirement: string;
    scope: string;
    urgency: TicketUrgency;
  }>,
): TicketEstimateResult => {
  const title =
    input.locale === 'es'
      ? `Petición: ${input.requirement.slice(0, 80)}`
      : input.locale === 'de'
        ? `Anfrage: ${input.requirement.slice(0, 80)}`
        : `Request: ${input.requirement.slice(0, 80)}`;
  const summary = [
    input.locale === 'es'
      ? 'Resumen estructurado (sin modelo):'
      : input.locale === 'de'
        ? 'Strukturierte Zusammenfassung (ohne Modell):'
        : 'Structured summary (without model):',
    `- ${input.requirement}`,
    `- ${input.scope}`,
    `- ${input.intent}`,
    `- ${input.kind} · ${input.urgency}`,
  ].join('\n');
  const effortEstimate =
    input.locale === 'es'
      ? 'Estimación tentativa: revisión manual del equipo (1–5 días hábiles según complejidad).'
      : input.locale === 'de'
        ? 'Vorläufige Schätzung: manuelle Prüfung durch das Team (1–5 Werktage je nach Komplexität).'
        : 'Tentative estimate: manual team review (1–5 business days depending on complexity).';
  return { effortEstimate, summary, title: title.slice(0, 240) };
};
