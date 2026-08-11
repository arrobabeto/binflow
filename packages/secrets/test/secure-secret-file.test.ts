import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadSecureSecretFile } from '../src/master-key-file.js';

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
