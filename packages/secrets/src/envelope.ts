import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

export type SecretContext = Readonly<{
  tenantId: string;
  credentialId: string;
  provider: string;
  keyVersion: number;
}>;

export type EncryptedSecretEnvelope = Readonly<{
  algorithm: 'aes-256-gcm';
  keyVersion: number;
  ciphertext: string;
  nonce: string;
  authTag: string;
  wrappedDek: string;
  wrapNonce: string;
  wrapAuthTag: string;
}>;

const aadFor = (context: SecretContext): Buffer =>
  Buffer.from(
    JSON.stringify({
      credentialId: context.credentialId,
      keyVersion: context.keyVersion,
      provider: context.provider,
      tenantId: context.tenantId,
    }),
    'utf8',
  );

const assertKey = (key: Uint8Array): void => {
  if (key.byteLength !== KEY_BYTES) {
    throw new Error('The master key must contain exactly 32 bytes.');
  }
};

export const encryptSecret = (
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  context: SecretContext,
): EncryptedSecretEnvelope => {
  assertKey(masterKey);
  const aad = aadFor(context);
  const dek = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const secretCipher = createCipheriv(ALGORITHM, dek, nonce);
  secretCipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    secretCipher.update(plaintext),
    secretCipher.final(),
  ]);
  const authTag = secretCipher.getAuthTag();

  const wrapNonce = randomBytes(NONCE_BYTES);
  const wrapCipher = createCipheriv(ALGORITHM, masterKey, wrapNonce);
  wrapCipher.setAAD(aad);
  const wrappedDek = Buffer.concat([
    wrapCipher.update(dek),
    wrapCipher.final(),
  ]);
  const wrapAuthTag = wrapCipher.getAuthTag();
  dek.fill(0);

  return {
    algorithm: ALGORITHM,
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keyVersion: context.keyVersion,
    nonce: nonce.toString('base64'),
    wrapAuthTag: wrapAuthTag.toString('base64'),
    wrappedDek: wrappedDek.toString('base64'),
    wrapNonce: wrapNonce.toString('base64'),
  };
};

export const decryptSecret = (
  envelope: EncryptedSecretEnvelope,
  masterKey: Uint8Array,
  context: SecretContext,
): Buffer => {
  assertKey(masterKey);
  if (envelope.keyVersion !== context.keyVersion) {
    throw new Error(
      'Secret key version does not match its encryption context.',
    );
  }
  const aad = aadFor(context);
  const wrapDecipher = createDecipheriv(
    ALGORITHM,
    masterKey,
    Buffer.from(envelope.wrapNonce, 'base64'),
  );
  wrapDecipher.setAAD(aad);
  wrapDecipher.setAuthTag(Buffer.from(envelope.wrapAuthTag, 'base64'));
  const dek = Buffer.concat([
    wrapDecipher.update(Buffer.from(envelope.wrappedDek, 'base64')),
    wrapDecipher.final(),
  ]);

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      dek,
      Buffer.from(envelope.nonce, 'base64'),
    );
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
  } finally {
    dek.fill(0);
  }
};
