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
  type TelegramMessage,
  type TelegramUser,
  type TelegramWebhookInfo,
} from '@chat-adapter/telegram';
import { Chat } from 'chat';
import { z } from 'zod';

import { DomainError } from '@binflow/domain';
import type { TelegramIngress, TelegramReply } from '@binflow/contracts';
import type {
  CredentialVerifier,
  CredentialVerifierInput,
  VerificationEvidence,
} from '@binflow/integrations';
import { decryptSecret } from '@binflow/secrets';

export type TelegramBotRole = 'admin' | 'client';

export type TelegramRuntimeConfig = Readonly<{
  apiBaseUrl?: string;
  allowedUserIds?: (number | string)[];
  botToken: string;
  redisUrl: string;
  role: TelegramBotRole;
  scopeKey: string;
  userName: string;
}>;

export type TelegramRuntime = Readonly<{
  adapter: TelegramAdapter;
  chat: Chat<{ telegram: TelegramAdapter }>;
}>;

export interface TelegramIngressHandler {
  handleTelegramUpdate(input: TelegramIngress): Promise<TelegramReply>;
}

export const registerClientTelegramHandlers = (
  runtime: TelegramRuntime,
  input: Readonly<{ botId: string; handler: TelegramIngressHandler }>,
): void => {
  runtime.chat.onDirectMessage(async (thread, message) => {
    const raw = message.raw as TelegramMessage;
    const externalUserId = raw.from?.id;
    if (externalUserId === undefined) return;
    const reply = await input.handler.handleTelegramUpdate({
      botId: input.botId,
      chatId: String(raw.chat.id),
      externalUserId: String(externalUserId),
      receivedAt: new Date(raw.date * 1000).toISOString(),
      text: message.text,
      updateId: String(raw.message_id),
    });
    const actions = reply.actionTokens
      .map((action) => `${action.label}: /action ${action.token}`)
      .join('\n');
    await thread.post(
      actions.length === 0 ? reply.text : `${reply.text}\n\n${actions}`,
    );
  });
};

export const createTelegramRuntime = async (
  config: TelegramRuntimeConfig,
): Promise<TelegramRuntime> => {
  await assertTelegramPollingAvailable(config);
  const adapter = createTelegramAdapter({
    ...(config.allowedUserIds === undefined
      ? {}
      : { allowedUserIds: config.allowedUserIds }),
    botToken: config.botToken,
    longPolling: { deleteWebhook: false },
    mode: 'polling',
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
