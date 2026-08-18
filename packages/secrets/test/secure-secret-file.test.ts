import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isRuntimeMasterKeyPermissionAllowed,
  loadRuntimeMasterKeyFile,
  loadSecureSecretFile,
} from '../src/master-key-file.js';

const temporaryDirectories: string[] = [];

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'binflow-secret-test-'));
  temporaryDirectories.push(root);
  const repository = join(root, 'repository');
  await mkdir(repository);
  return { repository, root };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('secure secret file import', () => {
  it('reads a bounded owner-only file outside the repository', async () => {
    const { repository, root } = await fixture();
    const path = join(root, 'github-app.pem');
    await writeFile(path, 'fixture-pem', { mode: 0o600 });

    const value = await loadSecureSecretFile(path, repository);
    expect(value.toString('utf8')).toBe('fixture-pem');
    value.fill(0);
  });

  it('rejects files with broader permissions', async () => {
    const { repository, root } = await fixture();
    const path = join(root, 'github-app.pem');
    await writeFile(path, 'fixture-pem', { mode: 0o600 });
    await chmod(path, 0o640);

    await expect(loadSecureSecretFile(path, repository)).rejects.toThrow(
      'permissions must be 0600',
    );
  });

  it('rejects files inside the repository', async () => {
    const { repository } = await fixture();
    const path = join(repository, 'github-app.pem');
    await writeFile(path, 'fixture-pem', { mode: 0o600 });

    await expect(loadSecureSecretFile(path, repository)).rejects.toThrow(
      'outside the repository',
    );
  });

  it('rejects oversized files', async () => {
    const { repository, root } = await fixture();
    const path = join(root, 'github-app.pem');
    await writeFile(path, Buffer.alloc(64 * 1024 + 1), { mode: 0o600 });

    await expect(loadSecureSecretFile(path, repository)).rejects.toThrow(
      'outside the supported range',
    );
  });
});

describe('runtime master key loading', () => {
  it('accepts only read-only Docker secret modes under /run/secrets', () => {
    for (const mode of [0o400, 0o440, 0o444]) {
      expect(
        isRuntimeMasterKeyPermissionAllowed('/run/secrets/binflow_kek', mode),
      ).toBe(true);
    }
    for (const mode of [0o600, 0o640, 0o644, 0o666]) {
      expect(
        isRuntimeMasterKeyPermissionAllowed('/run/secrets/binflow_kek', mode),
      ).toBe(false);
    }
    expect(
      isRuntimeMasterKeyPermissionAllowed(
        '/run/secrets/binflow_kek',
        0o600,
        true,
      ),
    ).toBe(true);
    expect(
      isRuntimeMasterKeyPermissionAllowed(
        '/run/secrets/binflow_kek',
        0o640,
        true,
      ),
    ).toBe(false);
    expect(isRuntimeMasterKeyPermissionAllowed('/tmp/binflow-kek', 0o600)).toBe(
      true,
    );
    expect(isRuntimeMasterKeyPermissionAllowed('/tmp/binflow-kek', 0o400)).toBe(
      false,
    );
  });

  it('accepts an exact 32-byte owner-only host key', async () => {
    const { root } = await fixture();
    const path = join(root, 'kek.key');
    await writeFile(path, Buffer.alloc(32, 7), { mode: 0o600 });

    const value = await loadRuntimeMasterKeyFile(path);
    expect(value).toEqual(Buffer.alloc(32, 7));
    value.fill(0);
  });

  it('rejects writable or broadly-readable host keys', async () => {
    const { root } = await fixture();
    const path = join(root, 'kek.key');
    await writeFile(path, Buffer.alloc(32), { mode: 0o600 });
    await chmod(path, 0o644);

    await expect(loadRuntimeMasterKeyFile(path)).rejects.toThrow(
      'permissions must be 0600',
    );
  });

  it('rejects a host key with the wrong size', async () => {
    const { root } = await fixture();
    const path = join(root, 'kek.key');
    await writeFile(path, Buffer.alloc(31), { mode: 0o600 });

    await expect(loadRuntimeMasterKeyFile(path)).rejects.toThrow(
      'exactly 32 bytes',
    );
  });
});
