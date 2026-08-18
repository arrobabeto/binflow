import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const KEY_BYTES = 32;
const MAX_SECRET_FILE_BYTES = 64 * 1024;

export const defaultMasterKeyPath = (): string =>
  join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'binflow',
    'kek-v1.key',
  );

const assertOutsideRepository = async (
  keyPath: string,
  repositoryPath: string,
): Promise<void> => {
  const repo = await realpath(repositoryPath);
  const candidate = await realpath(keyPath).catch(() => resolve(keyPath));
  const pathFromRepo = relative(repo, candidate);
  if (
    pathFromRepo === '' ||
    (!pathFromRepo.startsWith('..') && !isAbsolute(pathFromRepo))
  ) {
    throw new Error('The master key path must be outside the repository.');
  }
};

export const loadSecureSecretFile = async (
  secretPath: string,
  repositoryPath: string,
): Promise<Buffer> => {
  await assertOutsideRepository(secretPath, repositoryPath);
  const handle = await open(secretPath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error('The secret path must point to a regular file.');
    }
    if ((metadata.mode & 0o777) !== 0o600) {
      throw new Error('The secret file permissions must be 0600.');
    }
    if (metadata.size === 0 || metadata.size > MAX_SECRET_FILE_BYTES) {
      throw new Error('The secret file size is outside the supported range.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};

export const createMasterKeyFile = async (
  keyPath: string,
  repositoryPath: string,
): Promise<void> => {
  await assertOutsideRepository(keyPath, repositoryPath);
  await mkdir(dirname(keyPath), { mode: 0o700, recursive: true });
  const handle = await open(keyPath, 'wx', 0o600);
  try {
    await handle.writeFile(randomBytes(KEY_BYTES));
  } finally {
    await handle.close();
  }
  await chmod(keyPath, 0o600);
};

export const loadMasterKeyFile = async (
  keyPath: string,
  repositoryPath?: string,
): Promise<Buffer> => {
  if (repositoryPath !== undefined) {
    await assertOutsideRepository(keyPath, repositoryPath);
  }
  const metadata = await stat(keyPath);
  if (!metadata.isFile()) {
    throw new Error('The master key path must point to a regular file.');
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error('The master key file permissions must be 0600.');
  }
  const key = await readFile(keyPath);
  if (key.byteLength !== KEY_BYTES) {
    key.fill(0);
    throw new Error('The master key file must contain exactly 32 bytes.');
  }
  return key;
};

export const isRuntimeMasterKeyPermissionAllowed = (
  keyPath: string,
  mode: number,
  dockerMountReadonly = false,
): boolean => {
  const permissions = mode & 0o777;
  if (resolve(keyPath).startsWith('/run/secrets/')) {
    return (
      permissions === 0o400 ||
      permissions === 0o440 ||
      permissions === 0o444 ||
      (permissions === 0o600 && dockerMountReadonly)
    );
  }
  return permissions === 0o600;
};

const isReadonlyMount = async (keyPath: string): Promise<boolean> => {
  try {
    const probe = await open(keyPath, 'r+');
    await probe.close();
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EROFS';
  }
};

/** Loads the KEK for a runtime process without weakening host-file policy. */
export const loadRuntimeMasterKeyFile = async (
  keyPath: string,
): Promise<Buffer> => {
  const metadata = await stat(keyPath);
  if (!metadata.isFile()) {
    throw new Error(
      'The runtime master key path must point to a regular file.',
    );
  }
  const permissions = metadata.mode & 0o777;
  const isDockerSecret = resolve(keyPath).startsWith('/run/secrets/');
  const dockerMountReadonly =
    isDockerSecret && permissions === 0o600
      ? await isReadonlyMount(keyPath)
      : false;
  if (
    !isRuntimeMasterKeyPermissionAllowed(
      keyPath,
      permissions,
      dockerMountReadonly,
    )
  ) {
    throw new Error(
      isDockerSecret
        ? 'The runtime master key must be mounted read-only.'
        : 'The runtime master key file permissions must be 0600.',
    );
  }
  const key = await readFile(keyPath);
  if (key.byteLength !== KEY_BYTES) {
    key.fill(0);
    throw new Error(
      'The runtime master key file must contain exactly 32 bytes.',
    );
  }
  return key;
};
