import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { encryptSecret } from '@binflow/secrets';

import {
  createOpenAICredentialVerifier,
  phase0OpenAIModels,
} from '../src/index.js';

const createInput = () => {
  const masterKey = randomBytes(32);
  const secretContext = {
    credentialId: 'openai-credential',
    keyVersion: 1,
    provider: 'openai',
    tenantId: 'tenant-webbin',
  } as const;
  const plaintext = Buffer.from(JSON.stringify({ apiKey: 'test-api-key' }));
  const envelope = encryptSecret(plaintext, masterKey, secretContext);
  plaintext.fill(0);
  const credential: CredentialForVerification = {
    configuration: { requiredModels: phase0OpenAIModels },
    envelope,
    id: secretContext.credentialId,
    kind: 'openai',
    ownerScope: 'tenant',
    secretContext,
    status: 'unverified',
    tenantId: secretContext.tenantId,
    version: 1,
  };
  return {
    credential,
    masterKey,
    signal: AbortSignal.timeout(1_000),
  };
};

describe('OpenAI credential verifier', () => {
  it('checks model visibility without making a generation request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(String(input)).toBe('https://openai.test/v1/models');
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer test-api-key',
      );
      return new Response(
        JSON.stringify({ data: phase0OpenAIModels.map((id) => ({ id })) }),
        { headers: { 'x-request-id': 'request-safe' }, status: 200 },
      );
    });
    const verifier = createOpenAICredentialVerifier({
      apiBaseUrl: 'https://openai.test',
      fetch,
    });

    await expect(verifier.verify(createInput())).resolves.toMatchObject({
      modelCount: 4,
      requestId: 'request-safe',
      requiredModels: [...phase0OpenAIModels].sort(),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps a revoked or invalid key to authentication_error', async () => {
    const verifier = createOpenAICredentialVerifier({
      fetch: vi.fn(async () => new Response('{}', { status: 401 })),
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authentication_error',
    });
  });

  it('fails closed when any required model is unavailable', async () => {
    const verifier = createOpenAICredentialVerifier({
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ id: 'gpt-5.6-luna' }] }), {
            status: 200,
          }),
      ),
    });

    await expect(verifier.verify(createInput())).rejects.toMatchObject({
      category: 'authorization_error',
    });
  });
});
