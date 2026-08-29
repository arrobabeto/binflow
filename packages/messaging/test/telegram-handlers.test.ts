import type {
  TelegramCallbackQuery,
  TelegramMessage,
} from '@chat-adapter/telegram';
import { describe, expect, it, vi } from 'vitest';

import {
  isCardElement,
  previewUrlButtons,
  registerAdminTelegramHandlers,
  registerClientTelegramHandlers,
  renderClientTelegramReply,
  renderDeleteAdminPendingNotice,
  renderDeletePublicationCompleteNotice,
  renderPreviewReadyNotice,
  renderPublicationCompleteNotice,
  type TelegramRuntime,
} from '../src/index.js';

const actionToken = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDE';

const rawMessage = (text: string): TelegramMessage => ({
  chat: { id: 8080, type: 'private' },
  date: 1_787_126_400,
  from: { first_name: 'Owner', id: 42, is_bot: false },
  message_id: 71,
  text,
});

const fakeRuntime = () => {
  let actionHandler: ((event: unknown) => Promise<void> | void) | undefined;
  let directHandler:
    ((thread: unknown, message: unknown) => Promise<void>) | undefined;
  let slashHandler: ((event: unknown) => Promise<void>) | undefined;
  const chat = {
    onAction: vi.fn((handler) => {
      actionHandler = handler;
    }),
    onDirectMessage: vi.fn((handler) => {
      directHandler = handler;
    }),
    onSlashCommand: vi.fn((handler) => {
      slashHandler = handler;
    }),
  };
  return {
    action: () => actionHandler,
    direct: () => directHandler,
    runtime: { chat } as unknown as TelegramRuntime,
    slash: () => slashHandler,
  };
};

const buttonIds = (message: unknown): string[] => {
  if (!isCardElement(message)) return [];
  return message.children.flatMap((child) => {
    if (child.type !== 'actions') return [];
    return child.children.flatMap((action) =>
      action.type === 'button' ? [action.id] : [],
    );
  });
};

const linkUrls = (message: unknown): string[] => {
  if (!isCardElement(message)) return [];
  return message.children.flatMap((child) => {
    if (child.type !== 'actions') return [];
    return child.children.flatMap((action) =>
      action.type === 'link-button' ? [action.url] : [],
    );
  });
};

describe('Telegram runtime handlers', () => {
  it('routes admin /start through the slash dispatcher with its token', async () => {
    const fake = fakeRuntime();
    const handler = vi.fn(async () => ({
      actionTokens: [],
      locale: 'en' as const,
      requestId: null,
      text: 'Admin notification channel paired successfully.',
    }));
    const post = vi.fn(async () => undefined);
    registerAdminTelegramHandlers(fake.runtime, {
      botId: '8664708110',
      handler,
    });

    await fake.slash()?.({
      channel: { post },
      command: '/start',
      raw: rawMessage('/start opaque-token'),
      text: 'opaque-token',
    });

    expect(handler).toHaveBeenCalledWith({
      botId: '8664708110',
      chatId: '8080',
      externalUserId: '42',
      receivedAt: '2026-08-19T08:00:00.000Z',
      text: '/start opaque-token',
      updateId: '71',
    });
    expect(post).toHaveBeenCalledWith(
      'Admin notification channel paired successfully.',
    );
  });

  it('registers direct, slash and action dispatch for client commands', () => {
    const fake = fakeRuntime();
    const confirmTelegramReplyDelivered = vi.fn(async () => undefined);
    registerClientTelegramHandlers(fake.runtime, {
      botId: 'client-bot',
      handler: {
        confirmTelegramReplyDelivered,
        handleTelegramUpdate: vi.fn(async () => ({
          actionTokens: [],
          locale: 'en' as const,
          requestId: null,
          text: 'ok',
        })),
      },
    });

    expect(fake.direct()).toBeTypeOf('function');
    expect(fake.slash()).toBeTypeOf('function');
    expect(fake.action()).toBeTypeOf('function');
  });

  it('extracts photo attachments on slash commands without inventing [image] text', async () => {
    const fake = fakeRuntime();
    const handleTelegramUpdate = vi.fn(async () => ({
      actionTokens: [],
      locale: 'en' as const,
      requestId: null,
      text: 'ok',
    }));
    const persistInboundImage = vi.fn(async () => 'inbound/telegram/hero.webp');
    const post = vi.fn(async () => undefined);
    registerClientTelegramHandlers(fake.runtime, {
      botId: '1000000001',
      handler: {
        confirmTelegramReplyDelivered: vi.fn(async () => undefined),
        handleTelegramUpdate,
      },
      persistInboundImage,
    });

    await fake.slash()?.({
      attachments: [
        {
          data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
          mimeType: 'image/jpeg',
          type: 'image',
        },
      ],
      channel: { post },
      command: '/create_project',
      raw: rawMessage('/create_project'),
      text: '',
    });

    expect(persistInboundImage).toHaveBeenCalledOnce();
    expect(handleTelegramUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        imageArtifactKey: 'inbound/telegram/hero.webp',
        text: '/create_project',
      }),
    );
    expect(handleTelegramUpdate.mock.calls[0]?.[0].text).not.toContain(
      '[image]',
    );
  });

  it('posts plan actions as inline buttons instead of /action text', async () => {
    const fake = fakeRuntime();
    const post = vi.fn(async () => undefined);
    registerClientTelegramHandlers(fake.runtime, {
      botId: 'client-bot',
      handler: {
        confirmTelegramReplyDelivered: vi.fn(async () => undefined),
        handleTelegramUpdate: vi.fn(async () => ({
          actionTokens: [
            {
              action: 'confirm_plan' as const,
              label: 'Crear borrador',
              token: actionToken,
            },
          ],
          locale: 'es' as const,
          requestId: 'request-1',
          text: 'Plan listo.',
        })),
      },
    });

    await fake.slash()?.({
      channel: { post },
      command: '/create_blog',
      raw: rawMessage('/create_blog tema'),
      text: 'tema',
    });

    const posted = post.mock.calls[0]?.[0];
    expect(typeof posted).not.toBe('string');
    expect(JSON.stringify(posted)).not.toContain('/action');
    expect(buttonIds(posted)).toEqual([actionToken]);
  });

  it('treats a callback click as /action using the clicking user', async () => {
    const fake = fakeRuntime();
    const handleTelegramUpdate = vi.fn(async () => ({
      actionTokens: [],
      locale: 'es' as const,
      requestId: null,
      text: 'Plan confirmado.',
    }));
    const post = vi.fn(async () => undefined);
    registerClientTelegramHandlers(fake.runtime, {
      botId: '1000000001',
      handler: {
        confirmTelegramReplyDelivered: vi.fn(async () => undefined),
        handleTelegramUpdate,
      },
    });

    const callback: TelegramCallbackQuery = {
      chat_instance: 'instance',
      data: actionToken,
      from: { first_name: 'Client', id: 99, is_bot: false },
      id: '9001',
      message: {
        ...rawMessage('Plan listo.'),
        from: { first_name: 'Bot', id: 1, is_bot: true },
      },
    };

    await fake.action()?.({
      actionId: actionToken,
      raw: callback,
      thread: { post },
    });

    expect(handleTelegramUpdate).toHaveBeenCalledWith({
      botId: '1000000001',
      chatId: '8080',
      externalUserId: '99',
      receivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      text: `/action ${actionToken}`,
      updateId: '9001',
    });
    expect(post).toHaveBeenCalledWith('Plan confirmado.');
  });

  it('keeps typed /action as a slash fallback', async () => {
    const fake = fakeRuntime();
    const handleTelegramUpdate = vi.fn(async () => ({
      actionTokens: [],
      locale: 'en' as const,
      requestId: null,
      text: 'Preview approved.',
    }));
    const post = vi.fn(async () => undefined);
    registerClientTelegramHandlers(fake.runtime, {
      botId: 'client-bot',
      handler: {
        confirmTelegramReplyDelivered: vi.fn(async () => undefined),
        handleTelegramUpdate,
      },
    });

    await fake.slash()?.({
      channel: { post },
      command: '/action',
      raw: rawMessage(`/action ${actionToken}`),
      text: actionToken,
    });

    expect(handleTelegramUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        text: `/action ${actionToken}`,
        updateId: '71',
      }),
    );
  });

  it('confirms delivery only after the client reply was posted', async () => {
    const fake = fakeRuntime();
    const order: string[] = [];
    const confirmTelegramReplyDelivered = vi.fn(async () => {
      order.push('confirmed');
    });
    const post = vi.fn(async () => {
      order.push('posted');
    });
    registerClientTelegramHandlers(fake.runtime, {
      botId: 'client-bot',
      handler: {
        confirmTelegramReplyDelivered,
        handleTelegramUpdate: vi.fn(async () => ({
          actionTokens: [],
          locale: 'es' as const,
          requestId: null,
          text: 'Vinculación completada.',
        })),
      },
    });

    await fake.slash()?.({
      channel: { post },
      command: '/start',
      raw: rawMessage('/start opaque-token'),
      text: 'opaque-token',
    });

    expect(order).toEqual(['posted', 'confirmed']);

    post.mockRejectedValueOnce(new Error('Telegram unavailable'));
    await expect(
      fake.slash()?.({
        channel: { post },
        command: '/start',
        raw: { ...rawMessage('/start another-token'), message_id: 72 },
        text: 'another-token',
      }),
    ).rejects.toThrow('Telegram unavailable');
    expect(confirmTelegramReplyDelivered).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram client reply rendering', () => {
  it('leaves replies without actions as plain text', () => {
    expect(
      renderClientTelegramReply({
        actionTokens: [],
        duplicate: false,
        locale: 'en',
        requestId: null,
        text: 'Pairing complete.',
      }),
    ).toBe('Pairing complete.');
  });

  it('adds Spanish and English preview URL buttons', () => {
    const links = previewUrlButtons(
      {
        '/es/articulos/demo': 'https://preview.example/es/articulos/demo',
        '/articulos/demo': 'https://preview.example/articulos/demo',
      },
      'es',
    );
    expect(links).toEqual([
      {
        label: 'Abrir preview en español',
        url: 'https://preview.example/es/articulos/demo',
      },
      {
        label: 'Abrir preview en inglés',
        url: 'https://preview.example/articulos/demo',
      },
    ]);
    const notice = renderPreviewReadyNotice({
      locale: 'es',
      title: 'Demo',
      tokens: {
        approve: actionToken,
        cancel: `${actionToken}c`,
        revise: `${actionToken}r`,
      },
      urls: {
        '/es/articulos/demo': 'https://preview.example/es/articulos/demo',
        '/articulos/demo': 'https://preview.example/articulos/demo',
      },
    });
    expect(JSON.stringify(notice)).not.toContain('/action');
    expect(buttonIds(notice)).toEqual([
      actionToken,
      `${actionToken}r`,
      `${actionToken}c`,
    ]);
    expect(linkUrls(notice)).toEqual([
      'https://preview.example/es/articulos/demo',
      'https://preview.example/articulos/demo',
    ]);
  });

  it('posts publication complete as live-origin URL buttons', () => {
    const notice = renderPublicationCompleteNotice({
      locale: 'es',
      urls: {
        '/articulos/demo': 'https://webbin.com.mx/articulos/demo',
        '/es/articulos/demo': 'https://webbin.com.mx/es/articulos/demo',
      },
    });
    expect(JSON.stringify(notice)).not.toContain('/action');
    expect(JSON.stringify(notice)).not.toContain('vercel.app');
    expect(buttonIds(notice)).toEqual([]);
    expect(linkUrls(notice)).toEqual([
      'https://webbin.com.mx/articulos/demo',
      'https://webbin.com.mx/es/articulos/demo',
    ]);
  });

  it('posts delete admin pending as text-only without preview or cancel buttons', () => {
    const notice = renderDeleteAdminPendingNotice({
      locale: 'es',
      title: 'Mi Artículo',
    });
    expect(JSON.stringify(notice)).toContain('Mi Artículo');
    expect(JSON.stringify(notice)).toContain('artículo');
    expect(JSON.stringify(notice)).not.toContain('/action');
    expect(JSON.stringify(notice)).not.toContain('preview');
    expect(buttonIds(notice)).toEqual([]);
    expect(linkUrls(notice)).toEqual([]);
  });

  it('posts delete project admin pending with portfolio copy', () => {
    const notice = renderDeleteAdminPendingNotice({
      contentKind: 'portfolio',
      locale: 'es',
      title: 'Mi Proyecto',
    });
    expect(JSON.stringify(notice)).toContain('Mi Proyecto');
    expect(JSON.stringify(notice)).toContain('proyecto');
    expect(JSON.stringify(notice)).not.toContain('artículo');
    expect(buttonIds(notice)).toEqual([]);
  });

  it('posts delete publication complete as text-only', () => {
    const notice = renderDeletePublicationCompleteNotice({
      locale: 'es',
      title: 'Mi Artículo',
    });
    expect(JSON.stringify(notice)).toContain('eliminado');
    expect(buttonIds(notice)).toEqual([]);
    expect(linkUrls(notice)).toEqual([]);
  });

  it('posts delete project publication complete with portfolio copy', () => {
    const notice = renderDeletePublicationCompleteNotice({
      contentKind: 'portfolio',
      locale: 'es',
      title: 'Mi Proyecto',
    });
    expect(JSON.stringify(notice)).toContain('Mi Proyecto');
    expect(JSON.stringify(notice)).toContain('proyecto');
    expect(JSON.stringify(notice)).not.toContain('artículo');
  });
});
