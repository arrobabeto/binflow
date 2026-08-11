import { describe, expect, it, vi } from 'vitest';

import type { CredentialForVerification } from '@binflow/db';
import { DomainError, type ErrorCategory } from '@binflow/domain';

import {
  CredentialVerificationService,
  type CredentialVerificationRepository,
  type CredentialVerifier,
} from '../src/index.js';

const credential = (
  overrides: Partial<CredentialForVerification> = {},
): CredentialForVerification => ({
  configuration: {},
  envelope: {
    algorithm: 'aes-256-gcm',
    authTag: '',
    ciphertext: '',
    keyVersion: 1,
    nonce: '',
    wrapAuthTag: '',
    wrappedDek: '',
    wrapNonce: '',
  },
  id: 'credential-1',
  kind: 'openai',
  ownerScope: 'tenant',
  secretContext: {
    credentialId: 'credential-1',
    keyVersion: 1,
    provider: 'openai',
    tenantId: 'tenant-1',
  },
  status: 'unverified',
  tenantId: 'tenant-1',
  version: 1,
  ...overrides,
});

const repository = (
  current: CredentialForVerification = credential(),
): CredentialVerificationRepository => ({
  getCredential: vi.fn(async () => current),
  listCredentialIds: vi.fn(async () => [current.id]),
  recordFailure: vi.fn(async () => undefined),
  recordSuccess: vi.fn(async () => undefined),
});

const failingVerifier = (category: ErrorCategory): CredentialVerifier => ({
  kinds: ['openai'],
  verify: vi.fn(async () => {
    throw new DomainError(category, 'controlled failure');
  }),
});

describe('CredentialVerificationService', () => {
  it('records redacted evidence after a successful provider check', async () => {
    const store = repository();
    const verifier: CredentialVerifier = {
      kinds: ['openai'],
      verify: vi.fn(async () => ({ modelCount: 4, requiredModels: [] })),
    };
    const service = new CredentialVerificationService(store, [verifier]);

    await expect(
      service.verify('credential-1', new Uint8Array(32)),
    ).resolves.toMatchObject({
      evidence: { modelCount: 4, requiredModels: [] },
      outcome: 'success',
    });
    expect(store.recordSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential-1',
        evidence: { modelCount: 4, requiredModels: [] },
      }),
    );
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it.each([
    ['authentication_error', true],
    ['policy_denied', true],
    ['provider_retryable', false],
    ['credential_unavailable', false],
  ] satisfies [ErrorCategory, boolean][])(
    'classifies %s persistence as permanent=%s',
    async (category, permanent) => {
      const store = repository();
      const service = new CredentialVerificationService(store, [
        failingVerifier(category),
      ]);

      await expect(
        service.verify('credential-1', new Uint8Array(32)),
      ).resolves.toMatchObject({ errorCategory: category, outcome: 'failed' });
      expect(store.recordFailure).toHaveBeenCalledWith(
        expect.objectContaining({ category, permanent }),
      );
      expect(store.recordSuccess).not.toHaveBeenCalled();
    },
  );

  it('does not convert a concurrent revoke during activation into provider failure', async () => {
    const store = repository();
    vi.mocked(store.recordSuccess).mockRejectedValue(
      new DomainError(
        'credential_unavailable',
        'Credential became unavailable during verification.',
      ),
    );
    const service = new CredentialVerificationService(store, [
      {
        kinds: ['openai'],
        verify: vi.fn(async () => ({ modelCount: 4, requiredModels: [] })),
      },
    ]);

    await expect(
      service.verify('credential-1', new Uint8Array(32)),
    ).rejects.toMatchObject({ category: 'credential_unavailable' });
    expect(store.recordFailure).not.toHaveBeenCalled();
  });

  it('normalizes deterministic activation rejection and records the candidate failure', async () => {
    const store = repository();
    vi.mocked(store.recordSuccess).mockRejectedValue(
      new DomainError('policy_denied', 'Duplicate Telegram binding.'),
    );
    const service = new CredentialVerificationService(store, [
      {
        kinds: ['openai'],
        verify: vi.fn(async () => ({ modelCount: 4, requiredModels: [] })),
      },
    ]);

    await expect(
      service.verify('credential-1', new Uint8Array(32)),
    ).resolves.toMatchObject({
      errorCategory: 'policy_denied',
      outcome: 'failed',
    });
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'policy_denied', permanent: true }),
    );
  });

  it('blocks revoked credentials before invoking a provider', async () => {
    const store = repository(credential({ status: 'revoked' }));
    const verifier: CredentialVerifier = {
      kinds: ['openai'],
      verify: vi.fn(async () => ({})),
    };
    const service = new CredentialVerificationService(store, [verifier]);

    await expect(
      service.verify('credential-1', new Uint8Array(32)),
    ).rejects.toMatchObject({ category: 'credential_unavailable' });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it('rejects non-allowlisted evidence before persistence or output', async () => {
    const store = repository();
    const service = new CredentialVerificationService(store, [
      {
        kinds: ['openai'],
        verify: vi.fn(async () => ({
          modelCount: 4,
          requiredModels: [],
          token: 'must-never-escape',
        })),
      },
    ]);

    const result = await service.verify('credential-1', new Uint8Array(32));
    expect(result).toMatchObject({
      errorCategory: 'internal_error',
      outcome: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain('must-never-escape');
    expect(store.recordSuccess).not.toHaveBeenCalled();
    expect(store.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'internal_error', permanent: false }),
    );
  });
});
