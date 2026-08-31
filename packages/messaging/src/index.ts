import { createRedisState } from '@chat-adapter/state-redis';
import {
  AdapterRateLimitError,
  AuthenticationError,
  NetworkError,
  PermissionError,
  ValidationError,
} from '@chat-adapter/shared';
import {
  createTelegramAdapter,
  TelegramAdapter,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUser,
  type TelegramWebhookInfo,
} from '@chat-adapter/telegram';
import {
  Actions,
  Button,
  Card,
  CardText,
  Chat,
  isCardElement,
  LinkButton,
  type AdapterPostableMessage,
} from 'chat';
import { z } from 'zod';

import { DomainError } from '@binflow/domain';
import type {
  SupportedLocale,
  TelegramIngress,
  TelegramReply,
} from '@binflow/contracts';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';

export type TelegramBotRole = 'admin' | 'client';
export type TelegramIngressMode = 'polling' | 'send-only';

export type TelegramRuntimeConfig = Readonly<{
  apiBaseUrl?: string;
  allowedUserIds?: (number | string)[];
  botToken: string;
  ingress?: TelegramIngressMode;
  redisUrl: string;
  role: TelegramBotRole;
  scopeKey: string;
  userName: string;
}>;

export {
  TelegramPollingLock,
  telegramPollingLockKey,
  type RedisPollingLockClient,
} from './telegram-polling-lock.js';
export {
  selectSendOnlyTelegramBotsToPromote,
  selectUnstartedTelegramBots,
  type TelegramRuntimeCandidate,
  type TelegramRuntimeCredentialKind,
} from './telegram-runtime-reconcile.js';

export type TelegramRuntime = Readonly<{
  adapter: TelegramAdapter;
  chat: Chat<{ telegram: TelegramAdapter }>;
}>;

export interface TelegramIngressHandler {
  handleTelegramUpdate(input: TelegramIngress): Promise<TelegramReply>;
  confirmTelegramReplyDelivered(input: TelegramIngress): Promise<void>;
}

type TelegramReplySink = Readonly<{
  post: (message: AdapterPostableMessage) => Promise<unknown>;
}>;

const ACTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/u;

export type TelegramPreviewLink = Readonly<{ label: string; url: string }>;

const actionButtonStyle = (
  action: TelegramReply['actionTokens'][number]['action'],
): 'primary' | 'danger' | 'default' => {
  if (action === 'cancel' || action === 'cancel_revision') return 'danger';
  if (
    action === 'confirm_plan' ||
    action === 'approve_preview' ||
    action === 'confirm_revision_plan'
  )
    return 'primary';
  return 'default';
};

export const renderClientTelegramReply = (
  reply: TelegramReply,
  links: readonly TelegramPreviewLink[] = [],
): AdapterPostableMessage => {
  if (reply.actionTokens.length === 0 && links.length === 0) return reply.text;
  return Card({
    children: [
      CardText(reply.text),
      ...(links.length === 0
        ? []
        : [
            Actions(
              links.map((link) =>
                LinkButton({ label: link.label, url: link.url }),
              ),
            ),
          ]),
      ...(reply.actionTokens.length === 0
        ? []
        : [
            Actions(
              reply.actionTokens.map((action) =>
                Button({
                  id: action.token,
                  label: action.label,
                  style: actionButtonStyle(action.action),
                }),
              ),
            ),
          ]),
    ],
  });
};

const previewLinkCopy: Record<
  SupportedLocale,
  Readonly<{ article: string; english: string; spanish: string }>
> = {
  de: {
    article: 'Vorschau öffnen',
    english: 'Englische Vorschau öffnen',
    spanish: 'Spanische Vorschau öffnen',
  },
  en: {
    article: 'Open preview',
    english: 'Open English preview',
    spanish: 'Open Spanish preview',
  },
  es: {
    article: 'Abrir preview',
    english: 'Abrir preview en inglés',
    spanish: 'Abrir preview en español',
  },
};

const productionLinkCopy: Record<
  SupportedLocale,
  Readonly<{ article: string; english: string; spanish: string }>
> = {
  de: {
    article: 'Artikel öffnen',
    english: 'Englischen Artikel öffnen',
    spanish: 'Spanischen Artikel öffnen',
  },
  en: {
    article: 'Open article',
    english: 'Open English article',
    spanish: 'Open Spanish article',
  },
  es: {
    article: 'Abrir artículo',
    english: 'Abrir artículo en inglés',
    spanish: 'Abrir artículo en español',
  },
};

const isSpanishContentRoute = (route: string): boolean =>
  route === '/es' || route.startsWith('/es/');

/** Webbin/`astro_repo` English article path shapes (not Orbitype `/posts/`). */
const isEnglishContentRoute = (route: string): boolean =>
  route.startsWith('/en/') ||
  route.startsWith('/articles/') ||
  route.startsWith('/articulos/');

const isOrbitypePostRoute = (route: string): boolean =>
  route.startsWith('/posts/');

const contentUrlButtons = (
  urls: Readonly<Record<string, string>>,
  labels: Readonly<{ english: string; spanish: string; article?: string }>,
): TelegramPreviewLink[] => {
  const links: TelegramPreviewLink[] = [];
  const seen = new Set<string>();
  for (const [route, url] of Object.entries(urls)) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (isSpanishContentRoute(route)) {
      links.push({ label: labels.spanish, url });
      continue;
    }
    if (isEnglishContentRoute(route)) {
      links.push({ label: labels.english, url });
      continue;
    }
    if (isOrbitypePostRoute(route)) {
      links.push({ label: labels.article ?? 'Open', url });
      continue;
    }
    links.push({ label: route, url });
  }
  return links;
};

export const previewUrlButtons = (
  urls: Readonly<Record<string, string>>,
  locale: SupportedLocale,
): TelegramPreviewLink[] => contentUrlButtons(urls, previewLinkCopy[locale]);

const previewActionCopy: Record<
  SupportedLocale,
  Readonly<{ approve: string; cancel: string; revise: string; ready: string }>
> = {
  de: {
    approve: 'Freigeben',
    cancel: 'Abbrechen',
    ready: 'Vorschau bereit für',
    revise: 'Änderungen anfordern',
  },
  en: {
    approve: 'Approve',
    cancel: 'Cancel',
    ready: 'Preview ready for',
    revise: 'Request changes',
  },
  es: {
    approve: 'Aprobar',
    cancel: 'Cancelar',
    ready: 'Preview listo para',
    revise: 'Pedir cambios',
  },
};

export const renderPreviewReadyNotice = (
  input: Readonly<{
    locale: SupportedLocale;
    title: string;
    tokens: Readonly<{ approve: string; cancel: string; revise: string }>;
    urls: Readonly<Record<string, string>>;
  }>,
): AdapterPostableMessage => {
  const copy = previewActionCopy[input.locale];
  return renderClientTelegramReply(
    {
      actionTokens: [
        {
          action: 'approve_preview',
          label: copy.approve,
          token: input.tokens.approve,
        },
        {
          action: 'request_revision',
          label: copy.revise,
          token: input.tokens.revise,
        },
        { action: 'cancel', label: copy.cancel, token: input.tokens.cancel },
      ],
      duplicate: false,
      locale: input.locale,
      requestId: null,
      text: `${copy.ready} ${input.title}.`,
    },
    previewUrlButtons(input.urls, input.locale),
  );
};

const deleteAdminPendingCopy: Record<
  'blog' | 'portfolio',
  Record<SupportedLocale, Readonly<{ pending: (title: string) => string }>>
> = {
  blog: {
    de: {
      pending: (title) =>
        `Löschanfrage für «${title}» wird von einem Admin geprüft. Wir benachrichtigen dich, wenn der Artikel gelöscht wurde.`,
    },
    en: {
      pending: (title) =>
        `Deletion request for «${title}» is under admin review. We will notify you when the article is removed.`,
    },
    es: {
      pending: (title) =>
        `Solicitud de borrado de «${title}» en revisión por un admin. Te avisaremos cuando el artículo se elimine.`,
    },
  },
  portfolio: {
    de: {
      pending: (title) =>
        `Löschanfrage für das Portfolio-Projekt «${title}» wird von einem Admin geprüft. Wir benachrichtigen dich, wenn es gelöscht wurde.`,
    },
    en: {
      pending: (title) =>
        `Deletion request for portfolio project «${title}» is under admin review. We will notify you when it is removed.`,
    },
    es: {
      pending: (title) =>
        `Solicitud de borrado del proyecto «${title}» en revisión por un admin. Te avisaremos cuando el proyecto se elimine.`,
    },
  },
};

export type DeleteNoticeContentKind = keyof typeof deleteAdminPendingCopy;

export const renderDeleteAdminPendingNotice = (
  input: Readonly<{
    contentKind?: DeleteNoticeContentKind;
    locale: SupportedLocale;
    title: string;
  }>,
): AdapterPostableMessage => {
  const contentKind = input.contentKind ?? 'blog';
  const copy = deleteAdminPendingCopy[contentKind][input.locale];
  return renderClientTelegramReply({
    actionTokens: [],
    duplicate: false,
    locale: input.locale,
    requestId: null,
    text: copy.pending(input.title),
  });
};

const deletePublicationCopy: Record<
  'blog' | 'portfolio',
  Record<SupportedLocale, Readonly<{ done: (title: string) => string }>>
> = {
  blog: {
    de: {
      done: (title) => `Der Artikel «${title}» wurde gelöscht.`,
    },
    en: {
      done: (title) => `The article «${title}» was deleted.`,
    },
    es: {
      done: (title) => `El artículo «${title}» fue eliminado.`,
    },
  },
  portfolio: {
    de: {
      done: (title) => `Das Portfolio-Projekt «${title}» wurde gelöscht.`,
    },
    en: {
      done: (title) => `The portfolio project «${title}» was deleted.`,
    },
    es: {
      done: (title) => `El proyecto «${title}» fue eliminado.`,
    },
  },
};

export const renderDeletePublicationCompleteNotice = (
  input: Readonly<{
    contentKind?: DeleteNoticeContentKind;
    locale: SupportedLocale;
    title: string;
  }>,
): AdapterPostableMessage =>
  renderClientTelegramReply({
    actionTokens: [],
    duplicate: false,
    locale: input.locale,
    requestId: null,
    text: deletePublicationCopy[input.contentKind ?? 'blog'][input.locale].done(
      input.title,
    ),
  });

/** @deprecated Use renderDeleteAdminPendingNotice — no client CTAs during admin review. */
export const renderDeletePreviewPendingNotice = (
  input: Readonly<{
    locale: SupportedLocale;
    slug: string;
    token: string;
    urls: Readonly<Record<string, string>>;
  }>,
): AdapterPostableMessage =>
  renderDeleteAdminPendingNotice({
    locale: input.locale,
    title: input.slug,
  });

const revisionPlanCopy: Record<
  SupportedLocale,
  Readonly<{
    adjust: string;
    cancel: string;
    confirm: string;
    heading: string;
  }>
> = {
  de: {
    adjust: 'Anfrage anpassen',
    cancel: 'Revision abbrechen',
    confirm: 'Änderung bestätigen',
    heading: 'Änderungsplan',
  },
  en: {
    adjust: 'Adjust request',
    cancel: 'Cancel revision',
    confirm: 'Confirm change',
    heading: 'Change plan',
  },
  es: {
    adjust: 'Ajustar pedido',
    cancel: 'Cancelar revisión',
    confirm: 'Confirmar cambio',
    heading: 'Plan de cambio',
  },
};

export const renderRevisionPlanNotice = (
  input: Readonly<{
    locale: SupportedLocale;
    summary: string;
    tokens: Readonly<{ adjust: string; cancel: string; confirm: string }>;
  }>,
): AdapterPostableMessage => {
  const copy = revisionPlanCopy[input.locale];
  return renderClientTelegramReply({
    actionTokens: [
      {
        action: 'confirm_revision_plan',
        label: copy.confirm,
        token: input.tokens.confirm,
      },
      {
        action: 'adjust_revision_plan',
        label: copy.adjust,
        token: input.tokens.adjust,
      },
      {
        action: 'cancel_revision',
        label: copy.cancel,
        token: input.tokens.cancel,
      },
    ],
    duplicate: false,
    locale: input.locale,
    requestId: null,
    text: `${copy.heading}\n\n${input.summary}`,
  });
};

const publicationCopy: Record<SupportedLocale, Readonly<{ done: string }>> = {
  de: { done: 'Veröffentlichung abgeschlossen.' },
  en: { done: 'Publication complete.' },
  es: { done: 'Publicación completada.' },
};

export const renderPublicationCompleteNotice = (
  input: Readonly<{
    locale: SupportedLocale;
    urls: Readonly<Record<string, string>>;
  }>,
): AdapterPostableMessage =>
  renderClientTelegramReply(
    {
      actionTokens: [],
      duplicate: false,
      locale: input.locale,
      requestId: null,
      text: publicationCopy[input.locale].done,
    },
    contentUrlButtons(input.urls, productionLinkCopy[input.locale]),
  );

export { isCardElement };

const telegramIngress = (
  botId: string,
  raw: TelegramMessage,
  text: string,
  imageArtifactKey?: string,
): TelegramIngress | null => {
  const externalUserId = raw.from?.id;
  if (externalUserId === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 && imageArtifactKey === undefined) return null;
  return {
    botId,
    chatId: String(raw.chat.id),
    externalUserId: String(externalUserId),
    receivedAt: new Date(raw.date * 1000).toISOString(),
    text: trimmed,
    updateId: String(raw.message_id),
    ...(imageArtifactKey === undefined ? {} : { imageArtifactKey }),
  };
};

const telegramCallbackIngress = (
  botId: string,
  query: TelegramCallbackQuery,
  token: string,
): TelegramIngress | null => {
  const message = query.message;
  if (message === undefined || !/^\d+$/u.test(query.id)) return null;
  return {
    botId,
    chatId: String(message.chat.id),
    externalUserId: String(query.from.id),
    receivedAt: new Date().toISOString(),
    text: `/action ${token}`,
    updateId: query.id,
  };
};

const commandText = (command: string, argumentsText: string): string =>
  argumentsText.length === 0 ? command : `${command} ${argumentsText}`;

const MAX_INBOUND_IMAGE_BYTES = 8_000_000;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export type PersistInboundImage = (input: Readonly<{
  bytes: Uint8Array;
  mime: string;
}>) => Promise<string>;

const extractInboundImageArtifactKey = async (
  message: Readonly<{
    attachments: ReadonlyArray<{
      data?: Buffer | Blob;
      fetchData?: () => Promise<Buffer>;
      mimeType?: string;
      type: string;
    }>;
  }>,
  persistInboundImage: PersistInboundImage | undefined,
): Promise<string | undefined> => {
  if (persistInboundImage === undefined) return undefined;
  const image = message.attachments.find(
    (attachment) => attachment.type === 'image',
  );
  if (image === undefined) return undefined;
  const mime = (image.mimeType ?? 'image/jpeg').toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(mime))
    throw new DomainError(
      'validation_error',
      'Only JPEG, PNG or WebP hero screenshots are accepted.',
      { code: 'attachment_mime_denied' },
    );
  const raw =
    image.data !== undefined
      ? image.data
      : image.fetchData !== undefined
        ? await image.fetchData()
        : undefined;
  if (raw === undefined)
    throw new DomainError(
      'provider_final',
      'Telegram image attachment could not be downloaded.',
    );
  const bytes = Buffer.isBuffer(raw)
    ? new Uint8Array(raw)
    : new Uint8Array(await (raw as Blob).arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_IMAGE_BYTES)
    throw new DomainError(
      'validation_error',
      'Hero screenshot exceeds the allowed size.',
      { code: 'attachment_too_large' },
    );
  return persistInboundImage({ bytes, mime });
};

const registerTelegramIngressHandlers = (
  runtime: TelegramRuntime,
  input: Readonly<{
    afterReplyDelivered?: (update: TelegramIngress) => Promise<void>;
    botId: string;
    handler: (update: TelegramIngress) => Promise<TelegramReply>;
    persistInboundImage?: PersistInboundImage;
    render: (reply: TelegramReply) => AdapterPostableMessage;
  }>,
): ((
  update: TelegramIngress | null,
  sink: TelegramReplySink,
) => Promise<void>) => {
  const dispatch = async (
    update: TelegramIngress | null,
    sink: TelegramReplySink,
  ): Promise<void> => {
    if (update === null) return;
    const reply = await input.handler(update);
    await sink.post(input.render(reply));
    await input.afterReplyDelivered?.(update);
  };

  runtime.chat.onDirectMessage(async (thread, message) => {
    let imageArtifactKey: string | undefined;
    try {
      imageArtifactKey = await extractInboundImageArtifactKey(
        message,
        input.persistInboundImage,
      );
    } catch (error) {
      const text =
        error instanceof DomainError
          ? error.message
          : 'The image attachment was rejected.';
      await thread.post(text);
      return;
    }
    await dispatch(
      telegramIngress(
        input.botId,
        message.raw as TelegramMessage,
        message.text,
        imageArtifactKey,
      ),
      thread,
    );
  });
  runtime.chat.onSlashCommand(async (event) => {
    let imageArtifactKey: string | undefined;
    try {
      imageArtifactKey = await extractInboundImageArtifactKey(
        {
          attachments:
            (
              event as {
                attachments?: ReadonlyArray<{
                  data?: Buffer | Blob;
                  fetchData?: () => Promise<Buffer>;
                  mimeType?: string;
                  type: string;
                }>;
              }
            ).attachments ??
            (
              event as {
                message?: {
                  attachments?: ReadonlyArray<{
                    data?: Buffer | Blob;
                    fetchData?: () => Promise<Buffer>;
                    mimeType?: string;
                    type: string;
                  }>;
                };
              }
            ).message?.attachments ??
            [],
        },
        input.persistInboundImage,
      );
    } catch (error) {
      const text =
        error instanceof DomainError
          ? error.message
          : 'The image attachment was rejected.';
      await event.channel.post(text);
      return;
    }
    await dispatch(
      telegramIngress(
        input.botId,
        event.raw as TelegramMessage,
        commandText(event.command, event.text),
        imageArtifactKey,
      ),
      event.channel,
    );
  });
  return dispatch;
};

export const registerClientTelegramHandlers = (
  runtime: TelegramRuntime,
  input: Readonly<{
    botId: string;
    handler: TelegramIngressHandler;
    persistInboundImage?: PersistInboundImage;
  }>,
): void => {
  const dispatch = registerTelegramIngressHandlers(runtime, {
    afterReplyDelivered: (update) =>
      input.handler.confirmTelegramReplyDelivered(update),
    botId: input.botId,
    handler: (update) => input.handler.handleTelegramUpdate(update),
    ...(input.persistInboundImage === undefined
      ? {}
      : { persistInboundImage: input.persistInboundImage }),
    render: (reply) => renderClientTelegramReply(reply),
  });
  runtime.chat.onAction(async (event) => {
    if (!ACTION_TOKEN_PATTERN.test(event.actionId) || event.thread === null)
      return;
    await dispatch(
      telegramCallbackIngress(
        input.botId,
        event.raw as TelegramCallbackQuery,
        event.actionId,
      ),
      event.thread,
    );
  });
};

export const registerAdminTelegramHandlers = (
  runtime: TelegramRuntime,
  input: Readonly<{
    botId: string;
    handler: (update: TelegramIngress) => Promise<TelegramReply>;
  }>,
): void => {
  registerTelegramIngressHandlers(runtime, {
    botId: input.botId,
    handler: input.handler,
    render: (reply) => reply.text,
  });
};

export const createTelegramRuntime = async (
  config: TelegramRuntimeConfig,
): Promise<TelegramRuntime> => {
  const ingress = config.ingress ?? 'polling';
  if (ingress === 'polling') await assertTelegramPollingAvailable(config);
  const adapter = createTelegramAdapter({
    ...(config.allowedUserIds === undefined
      ? {}
      : { allowedUserIds: config.allowedUserIds }),
    botToken: config.botToken,
    ...(ingress === 'polling'
      ? {
          longPolling: {
            allowedUpdates: ['message', 'callback_query'],
            deleteWebhook: false,
          },
        }
      : {}),
    mode: ingress === 'send-only' ? 'webhook' : 'polling',
    userName: config.userName,
  });
  const state = createRedisState({
    keyPrefix: `binflow:chat:${config.role}:${config.scopeKey}`,
    url: config.redisUrl,
  });
  const chat = new Chat({
    adapters: { telegram: adapter },
    dedupeTtlMs: 600_000,
    state,
    userName: config.userName,
  });
  return { adapter, chat };
};

export const syncTelegramBotCommands = async (
  botToken: string,
  commands: ReadonlyArray<Readonly<{ command: string; description: string }>>,
): Promise<void> => {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/setMyCommands`,
    {
      body: JSON.stringify({
        commands: commands.map((item) => ({
          command: item.command.replace(/^\//u, ''),
          description: item.description.slice(0, 256),
        })),
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  );
  if (!response.ok)
    throw new DomainError(
      'provider_retryable',
      'Telegram setMyCommands failed.',
    );
};

export interface MessagingGateway {
  notifyAdmin(message: string): Promise<void>;
  replyToClient(conversationId: string, message: string): Promise<void>;
}

export class FakeMessagingGateway implements MessagingGateway {
  public readonly adminNotifications: string[] = [];
  public readonly clientReplies: {
    conversationId: string;
    message: string;
  }[] = [];

  public notifyAdmin(message: string): Promise<void> {
    this.adminNotifications.push(message);
    return Promise.resolve();
  }

  public replyToClient(conversationId: string, message: string): Promise<void> {
    this.clientReplies.push({ conversationId, message });
    return Promise.resolve();
  }
}

const telegramSecretSchema = z.object({ botToken: z.string().min(1) }).strict();
const telegramConfigurationSchema = z
  .object({
    expectedUsername: z.string().min(1),
    role: z.enum(['admin', 'client']),
  })
  .strict();
const telegramIdentitySchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  is_bot: z.boolean(),
  username: z.string().min(1).optional(),
});
const telegramTransportSchema = z.object({
  pending_update_count: z.number().int().nonnegative(),
  url: z.string(),
});

class TelegramProbeAdapter extends TelegramAdapter {
  public getIdentity(signal: AbortSignal): Promise<TelegramUser> {
    return this.telegramFetch<TelegramUser>('getMe', {}, { signal });
  }

  public getTransport(signal: AbortSignal): Promise<TelegramWebhookInfo> {
    return this.telegramFetch<TelegramWebhookInfo>(
      'getWebhookInfo',
      {},
      { signal },
    );
  }
}

const normalizeTelegramUsername = (value: string): string =>
  value.trim().replace(/^@/, '').toLowerCase();

const mapTelegramError = (error: unknown): DomainError => {
  if (error instanceof AuthenticationError) {
    return new DomainError(
      'authentication_error',
      'Telegram rejected the bot credential.',
    );
  }
  if (error instanceof PermissionError) {
    return new DomainError(
      'authorization_error',
      'Telegram denied the credential verification request.',
    );
  }
  if (
    error instanceof AdapterRateLimitError ||
    error instanceof NetworkError ||
    (error instanceof DOMException && error.name === 'AbortError')
  ) {
    return new DomainError(
      'provider_retryable',
      'Telegram is temporarily unavailable.',
    );
  }
  if (error instanceof ValidationError) {
    return new DomainError(
      'provider_final',
      'Telegram returned an invalid response.',
    );
  }
  return new DomainError(
    'provider_retryable',
    'Telegram verification could not be completed.',
  );
};

async function assertTelegramPollingAvailable(
  config: TelegramRuntimeConfig,
): Promise<void> {
  const probe = new TelegramProbeAdapter({
    ...(config.apiBaseUrl === undefined ? {} : { apiUrl: config.apiBaseUrl }),
    botToken: config.botToken,
    mode: 'polling',
    userName: config.userName,
  });
  try {
    const transport = telegramTransportSchema.parse(
      await probe.getTransport(AbortSignal.timeout(15_000)),
    );
    if (transport.url !== '') {
      throw new DomainError(
        'conflict_error',
        'Telegram bot already has a webhook and cannot start local polling.',
      );
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (error instanceof z.ZodError) {
      throw new DomainError(
        'provider_final',
        'Telegram returned an invalid transport response.',
      );
    }
    throw mapTelegramError(error);
  }
}

export const createTelegramCredentialVerifier = (
  options: Readonly<{ apiBaseUrl?: string }> = {},
): CredentialVerifier => ({
  kinds: ['telegram-admin', 'telegram-client'],
  async verify(input: CredentialVerifierInput): Promise<VerificationEvidence> {
    let configuration: z.infer<typeof telegramConfigurationSchema>;
    try {
      configuration = telegramConfigurationSchema.parse(
        input.credential.configuration,
      );
    } catch {
      throw new DomainError(
        'validation_error',
        'Telegram credential configuration is invalid.',
      );
    }
    const expectedRole =
      input.credential.kind === 'telegram-admin' ? 'admin' : 'client';
    if (configuration.role !== expectedRole) {
      throw new DomainError(
        'policy_denied',
        'Telegram bot role does not match its credential kind.',
      );
    }

    const plaintext = decryptSecret(
      input.credential.envelope,
      input.masterKey,
      input.credential.secretContext,
    );
    try {
      let secret: z.infer<typeof telegramSecretSchema>;
      try {
        secret = telegramSecretSchema.parse(
          JSON.parse(plaintext.toString('utf8')),
        );
      } catch {
        throw new DomainError(
          'validation_error',
          'Telegram credential payload is invalid.',
        );
      }

      const adapter = new TelegramProbeAdapter({
        ...(options.apiBaseUrl === undefined
          ? {}
          : { apiUrl: options.apiBaseUrl }),
        botToken: secret.botToken,
        mode: 'polling',
        userName: configuration.expectedUsername,
      });
      let identity: z.infer<typeof telegramIdentitySchema>;
      let transport: z.infer<typeof telegramTransportSchema>;
      try {
        const [identityResponse, transportResponse] = await Promise.all([
          adapter.getIdentity(input.signal),
          adapter.getTransport(input.signal),
        ]);
        identity = telegramIdentitySchema.parse(identityResponse);
        transport = telegramTransportSchema.parse(transportResponse);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new DomainError(
            'provider_final',
            'Telegram returned an invalid identity or transport response.',
          );
        }
        throw mapTelegramError(error);
      }
      if (!identity.is_bot || identity.username === undefined) {
        throw new DomainError(
          'provider_final',
          'Telegram credential did not resolve to a named bot.',
        );
      }
      if (
        normalizeTelegramUsername(identity.username) !==
        normalizeTelegramUsername(configuration.expectedUsername)
      ) {
        throw new DomainError(
          'policy_denied',
          'Telegram bot identity does not match the expected username.',
        );
      }
      if (transport.url !== '') {
        throw new DomainError(
          'conflict_error',
          'Telegram bot already has a webhook and cannot use local polling.',
        );
      }

      return {
        botId: String(identity.id),
        externalResourceId: String(identity.id),
        pendingUpdateCount: transport.pending_update_count,
        role: configuration.role,
        transport: 'polling',
        username: identity.username,
        webhookConfigured: false,
      };
    } finally {
      plaintext.fill(0);
    }
  },
});
