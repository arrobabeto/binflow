import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createTelegramCredentialVerifier,
  createTelegramRuntime,
} from '../src/index.js';

const createInput = (
  kind: 'telegram-admin' | 'telegram-client' = 'telegram-client',
) => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'telegram-credential',
    keyVersion: 1,
    provider: kind,
    tenantId: kind === 'telegram-admin' ? 'platform' : 'tenant-webbin',
  } as const;
  const plaintext = Buffer.from(JSON.stringify({ botToken: 'bot-token' }));
  const envelope = encryptSecret(plaintext, masterKey, secretContext);
  plaintext.fill(0);
  const credential: CredentialForVerification = {
    configuration: {
      expectedUsername: 'binflow_client_bot',
      role: kind === 'telegram-admin' ? 'admin' : 'client',
    },
    envelope,
    id: secretContext.credentialId,
    kind,
    ownerScope: kind === 'telegram-admin' ? 'platform' : 'tenant',
    secretContext,
    status: 'unverified',
    ...(kind === 'telegram-client' ? { tenantId: 'tenant-webbin' } : {}),
    version: 1,
  };
  return {
    credential,
    masterKey,
    signal: AbortSignal.timeout(1_000),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('Telegram credential verifier', () => {
  it('uses only identity and transport reads', async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const method = new URL(String(input)).pathname.split('/').at(-1)!;
        methods.push(method);
        const result =
          method === 'getMe'
            ? { id: 42, is_bot: true, username: 'Binflow_Client_Bot' }
            : { pending_update_count: 0, url: '' };
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
        });
      }),
    );
    const verifier = createTelegramCredentialVerifier({
      apiBaseUrl: 'https://telegram.test',
    });

    await expect(verifier.verify(createInput())).resolves.toMatchObject({
      botId: '42',
      externalResourceId: '42',
      role: 'client',
      transport: 'polling',
      webhookConfigured: false,
    });
    expect(methods.sort()).toEqual(['getMe', 'getWebhookInfo']);
  });

  it('rejects identity mismatch without changing webhook state', async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const method = new URL(String(input)).pathname.split('/').at(-1)!;
        methods.push(method);
        return new Response(
          JSON.stringify({
            ok: true,
            result:
              method === 'getMe'
                ? { id: 42, is_bot: true, username: 'another_bot' }
                : { pending_update_count: 0, url: '' },
          }),
          { status: 200 },
        );
      }),
    );
    const verifier = createTelegramCredentialVerifier({
      apiBaseUrl: 'https://telegram.test',
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'policy_denied',
    });
    expect(methods).not.toContain('deleteWebhook');
    expect(methods).not.toContain('setWebhook');
    expect(methods).not.toContain('sendMessage');
  });

  it('reports an existing webhook as a polling conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const method = new URL(String(input)).pathname.split('/').at(-1)!;
        return new Response(
          JSON.stringify({
            ok: true,
            result:
              method === 'getMe'
                ? { id: 42, is_bot: true, username: 'binflow_client_bot' }
                : {
                    pending_update_count: 0,
                    url: 'https://production.example/telegram',
                  },
          }),
          { status: 200 },
        );
      }),
    );
    const verifier = createTelegramCredentialVerifier({
      apiBaseUrl: 'https://telegram.test',
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'conflict_error',
    });
  });

  it('fails closed on a malformed provider response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const method = new URL(String(input)).pathname.split('/').at(-1)!;
        return new Response(
          JSON.stringify({
            ok: true,
            result:
              method === 'getMe'
                ? { is_bot: true, username: 'binflow_client_bot' }
                : { pending_update_count: -1, url: '' },
          }),
        );
      }),
    );
    const verifier = createTelegramCredentialVerifier({
      apiBaseUrl: 'https://telegram.test',
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'provider_final',
    });
  });

  it('fails runtime startup before polling when a webhook appeared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              result: {
                pending_update_count: 0,
                url: 'https://production.example/telegram',
              },
            }),
          ),
      ),
    );

    await expect(
      createTelegramRuntime({
        apiBaseUrl: 'https://telegram.test',
        botToken: 'bot-token',
        redisUrl: 'redis://localhost:6379',
        role: 'client',
        scopeKey: 'tenant-webbin',
        userName: 'binflow_client_bot',
      }),
    ).rejects.toMatchObject({ category: 'conflict_error' });
  });
});
