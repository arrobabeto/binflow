import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/envelope.js';

const context = {
  credentialId: 'credential-1',
  keyVersion: 1,
  provider: 'openai',
  tenantId: 'tenant-1',
} as const;

describe('secret envelope', () => {
  it('round trips a secret with authenticated context', () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret(Buffer.from('secret'), key, context);

    expect(decryptSecret(encrypted, key, context).toString('utf8')).toBe(
      'secret',
    );
  });

  it('rejects decryption under another tenant', () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret(Buffer.from('secret'), key, context);

    expect(() =>
      decryptSecret(encrypted, key, { ...context, tenantId: 'tenant-2' }),
    ).toThrow();
  });
});
