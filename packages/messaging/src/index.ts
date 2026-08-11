import { createRedisState } from '@chat-adapter/state-redis';
import {
  createTelegramAdapter,
  type TelegramAdapter,
} from '@chat-adapter/telegram';
import { Chat } from 'chat';

export type TelegramBotRole = 'admin' | 'client';

export type TelegramRuntimeConfig = Readonly<{
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

export const createTelegramRuntime = (
  config: TelegramRuntimeConfig,
): TelegramRuntime => {
  const adapter = createTelegramAdapter({
    ...(config.allowedUserIds === undefined
      ? {}
      : { allowedUserIds: config.allowedUserIds }),
    botToken: config.botToken,
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
