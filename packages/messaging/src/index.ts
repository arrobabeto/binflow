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
  Image,
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
  if (
    action === 'cancel' ||
    action === 'cancel_revision' ||
    action === 'reject_image_target'
  )
    return 'danger';
  if (
    action === 'confirm_plan' ||
    action === 'approve_preview' ||
    action === 'confirm_revision_plan' ||
    action === 'confirm_image_plan' ||
    action === 'confirm_text_plan' ||
    action === 'confirm_text_style_plan' ||
    action === 'confirm_menu_selection' ||
    action === 'done_text_style_attrs'
  )
    return 'primary';
  return 'default';
};

export type AdminTelegramActionToken = Readonly<{
  action: 'approve_publish' | 'reject';
  label: string;
  token: string;
}>;

export type AdminTelegramReply = Readonly<{
  actionTokens: readonly AdminTelegramActionToken[];
  text: string;
}>;

const adminActionButtonStyle = (
  action: AdminTelegramActionToken['action'],
): 'primary' | 'danger' | 'default' =>
  action === 'approve_publish'
    ? 'primary'
    : action === 'reject'
      ? 'danger'
      : 'default';

export const renderAdminTelegramReply = (
  reply: AdminTelegramReply,
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
                  style: adminActionButtonStyle(action.action),
                }),
              ),
            ),
          ]),
    ],
  });
};

export const renderClientTelegramReply = (
  reply: TelegramReply,
  links: readonly TelegramPreviewLink[] = [],
): AdapterPostableMessage => {
  if (
    reply.actionTokens.length === 0 &&
    links.length === 0 &&
    reply.photoUrl === undefined
  )
    return reply.text;
  return Card({
    children: [
      ...(reply.photoUrl === undefined
        ? []
        : [Image({ alt: 'Current image', url: reply.photoUrl })]),
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
    includeRevision?: boolean;
    locale: SupportedLocale;
    title: string;
    tokens: Readonly<{ approve: string; cancel: string; revise?: string }>;
    urls: Readonly<Record<string, string>>;
  }>,
): AdapterPostableMessage => {
  const copy = previewActionCopy[input.locale];
  const includeRevision = input.includeRevision !== false;
  const actionTokens = [
    {
      action: 'approve_preview' as const,
      label: copy.approve,
      token: input.tokens.approve,
    },
    ...(includeRevision && input.tokens.revise !== undefined
      ? [
          {
            action: 'request_revision' as const,
            label: copy.revise,
            token: input.tokens.revise,
          },
        ]
      : []),
    { action: 'cancel' as const, label: copy.cancel, token: input.tokens.cancel },
  ];
  return renderClientTelegramReply(
    {
      actionTokens,
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
  attachments: Readonly<{
    documentArtifactKey?: string;
    imageArtifactKey?: string;
  }> = {},
): TelegramIngress | null => {
  const externalUserId = raw.from?.id;
  if (externalUserId === undefined) return null;
  const trimmed = text.trim();
  if (
    trimmed.length === 0 &&
    attachments.imageArtifactKey === undefined &&
    attachments.documentArtifactKey === undefined
  )
    return null;
  return {
    botId,
    chatId: String(raw.chat.id),
    externalUserId: String(externalUserId),
    receivedAt: new Date(raw.date * 1000).toISOString(),
    text: trimmed,
    updateId: String(raw.message_id),
    ...(attachments.documentArtifactKey === undefined
      ? {}
      : { documentArtifactKey: attachments.documentArtifactKey }),
    ...(attachments.imageArtifactKey === undefined
      ? {}
      : { imageArtifactKey: attachments.imageArtifactKey }),
  };
};

const telegramCallbackIngress = (
  botId: string,
  query: TelegramCallbackQuery,
  token: string,
): TelegramIngress | null => {
  const message = query.message;
  if (message === undefined) return null;
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
const MAX_INBOUND_DOCUMENT_BYTES = 10_485_760;
const ALLOWED_DOCUMENT_MIMES = new Set(['application/pdf']);
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export type PersistInboundDocument = (input: Readonly<{
  bytes: Uint8Array;
  mime: string;
}>) => Promise<string>;

const normalizeInboundMime = (mime: string | undefined): string =>
  (mime ?? '').toLowerCase().split(';')[0]?.trim() ?? '';

const imageExtensionFromName = (name: string | undefined): string | null => {
  const lower = name?.toLowerCase() ?? '';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
};

/**
 * Telegram photos are `type: image`. Images sent "as file" arrive as
 * `type: file`/`document` with an image MIME or extension — still treat as
 * inbound images (edit_image / portfolio covers), not as menu PDFs.
 */
export const isInboundImageAttachment = (
  attachment: Readonly<{
    mimeType?: string;
    name?: string;
    type: string;
  }>,
): boolean => {
  if (attachment.type === 'image') return true;
  if (attachment.type !== 'document' && attachment.type !== 'file') return false;
  const mime = normalizeInboundMime(attachment.mimeType);
  if (ALLOWED_IMAGE_MIMES.has(mime)) return true;
  if (mime === 'application/octet-stream')
    return imageExtensionFromName(attachment.name) !== null;
  return false;
};

const resolveInboundImageMime = (
  attachment: Readonly<{
    mimeType?: string;
    name?: string;
    type: string;
  }>,
): string => {
  const mime = normalizeInboundMime(attachment.mimeType);
  if (ALLOWED_IMAGE_MIMES.has(mime))
    return mime === 'image/jpg' ? 'image/jpeg' : mime;
  const fromName = imageExtensionFromName(attachment.name);
  if (fromName !== null) return fromName;
  return attachment.type === 'image' ? 'image/jpeg' : mime;
};

const isMenuPdfAttachment = (
  attachment: Readonly<{
    mimeType?: string;
    name?: string;
    type: string;
  }>,
): boolean => {
  if (isInboundImageAttachment(attachment)) return false;
  if (attachment.type !== 'document' && attachment.type !== 'file') return false;
  const mime = normalizeInboundMime(attachment.mimeType) || 'application/pdf';
  if (ALLOWED_DOCUMENT_MIMES.has(mime)) return true;
  const name = attachment.name?.toLowerCase() ?? '';
  return (
    mime === 'application/octet-stream' &&
    (name.endsWith('.pdf') || name.includes('.pdf'))
  );
};

const extractInboundDocumentArtifactKey = async (
  message: Readonly<{
    attachments: ReadonlyArray<{
      data?: Buffer | Blob;
      fetchData?: () => Promise<Buffer>;
      mimeType?: string;
      name?: string;
      type: string;
    }>;
  }>,
  persistInboundDocument: PersistInboundDocument | undefined,
): Promise<string | undefined> => {
  if (persistInboundDocument === undefined) return undefined;
  const document = message.attachments.find((attachment) =>
    isMenuPdfAttachment(attachment),
  );
  if (document === undefined) return undefined;
  const mime = (document.mimeType ?? 'application/pdf').toLowerCase();
  if (
    !ALLOWED_DOCUMENT_MIMES.has(mime) &&
    !(
      mime === 'application/octet-stream' &&
      (document.name?.toLowerCase().endsWith('.pdf') ?? false)
    )
  )
    throw new DomainError(
      'validation_error',
      'Only PDF menu documents are accepted.',
      { code: 'attachment_mime_denied' },
    );
  const raw =
    document.data !== undefined
      ? document.data
      : document.fetchData !== undefined
        ? await document.fetchData()
        : undefined;
  if (raw === undefined)
    throw new DomainError(
      'provider_final',
      'Telegram document attachment could not be downloaded.',
    );
  const bytes = Buffer.isBuffer(raw)
    ? new Uint8Array(raw)
    : new Uint8Array(await (raw as Blob).arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_DOCUMENT_BYTES)
    throw new DomainError(
      'validation_error',
      'Menu PDF exceeds the allowed size.',
      { code: 'attachment_too_large' },
    );
  return persistInboundDocument({ bytes, mime });
};

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
      name?: string;
      type: string;
    }>;
  }>,
  persistInboundImage: PersistInboundImage | undefined,
): Promise<string | undefined> => {
  if (persistInboundImage === undefined) return undefined;
  const image = message.attachments.find((attachment) =>
    isInboundImageAttachment(attachment),
  );
  if (image === undefined) return undefined;
  const mime = resolveInboundImageMime(image);
  if (!ALLOWED_IMAGE_MIMES.has(mime))
    throw new DomainError(
      'validation_error',
      'Only JPEG, PNG or WebP images are accepted.',
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
      'Image attachment exceeds the allowed size.',
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
    persistInboundDocument?: PersistInboundDocument;
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
    try {
      const reply = await input.handler(update);
      await sink.post(input.render(reply));
      await input.afterReplyDelivered?.(update);
    } catch (error) {
      if (error instanceof DomainError) {
        await sink.post(error.message);
        return;
      }
      throw error;
    }
  };

  runtime.chat.onDirectMessage(async (thread, message) => {
    let imageArtifactKey: string | undefined;
    let documentArtifactKey: string | undefined;
    try {
      imageArtifactKey = await extractInboundImageArtifactKey(
        message,
        input.persistInboundImage,
      );
      documentArtifactKey = await extractInboundDocumentArtifactKey(
        message,
        input.persistInboundDocument,
      );
    } catch (error) {
      const text =
        error instanceof DomainError
          ? error.message
          : 'The attachment was rejected.';
      await thread.post(text);
      return;
    }
    const ingress = telegramIngress(
      input.botId,
      message.raw as TelegramMessage,
      message.text,
      {
        ...(documentArtifactKey === undefined ? {} : { documentArtifactKey }),
        ...(imageArtifactKey === undefined ? {} : { imageArtifactKey }),
      },
    );
    if (ingress === null) {
      const hasUnsupportedAttachment = message.attachments.some(
        (attachment) =>
          !isInboundImageAttachment(attachment) &&
          !isMenuPdfAttachment(attachment),
      );
      if (hasUnsupportedAttachment) {
        await thread.post(
          'This attachment type is not supported. Send a JPEG, PNG or WebP photo (or a PDF for menu updates).',
        );
        return;
      }
      return;
    }
    await dispatch(ingress, thread);
  });
  runtime.chat.onSlashCommand(async (event) => {
    let imageArtifactKey: string | undefined;
    let documentArtifactKey: string | undefined;
    const attachments =
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
      [];
    try {
      imageArtifactKey = await extractInboundImageArtifactKey(
        { attachments },
        input.persistInboundImage,
      );
      documentArtifactKey = await extractInboundDocumentArtifactKey(
        { attachments },
        input.persistInboundDocument,
      );
    } catch (error) {
      const text =
        error instanceof DomainError
          ? error.message
          : 'The attachment was rejected.';
      await event.channel.post(text);
      return;
    }
    await dispatch(
      telegramIngress(
        input.botId,
        event.raw as TelegramMessage,
        commandText(event.command, event.text),
        {
          ...(documentArtifactKey === undefined ? {} : { documentArtifactKey }),
          ...(imageArtifactKey === undefined ? {} : { imageArtifactKey }),
        },
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
    persistInboundDocument?: PersistInboundDocument;
    persistInboundImage?: PersistInboundImage;
  }>,
): void => {
  const dispatch = registerTelegramIngressHandlers(runtime, {
    afterReplyDelivered: (update) =>
      input.handler.confirmTelegramReplyDelivered(update),
    botId: input.botId,
    handler: (update) => input.handler.handleTelegramUpdate(update),
    ...(input.persistInboundDocument === undefined
      ? {}
      : { persistInboundDocument: input.persistInboundDocument }),
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
  const dispatch = registerTelegramIngressHandlers(runtime, {
    botId: input.botId,
    handler: input.handler,
    render: (reply) => {
      const adminTokens = reply.actionTokens.filter(
        (action): action is AdminTelegramActionToken =>
          action.action === 'approve_publish' || action.action === 'reject',
      );
      if (adminTokens.length === 0) return reply.text;
      return renderAdminTelegramReply({
        actionTokens: adminTokens,
        text: reply.text,
      });
    },
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

/**
 * Push the Telegram slash-command menu for a client bot.
 * Prefer building `commands` with
 * `@binflow/workflows` `buildTelegramClientCommands(locale, enabledIds)`
 * so descriptions match `/tools` (ADR-0054).
 */
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
