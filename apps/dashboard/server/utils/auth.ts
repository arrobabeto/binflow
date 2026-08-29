import { readFile } from 'node:fs/promises';

import {
  createBinflowAuthRuntime,
  defaultAuthSecretPath,
  type BinflowAuthRuntime,
} from '@binflow/auth';

let runtime: Promise<BinflowAuthRuntime> | undefined;

const readDatabaseUrl = async (): Promise<string> => {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL;
  if (process.env.DATABASE_URL_FILE !== undefined) {
    return (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
  }
  return 'postgresql://binflow_app:binflow_local_app@localhost:5432/binflow';
};

const authSecretSources = (): Readonly<{
  secret?: string;
  secretFile?: string;
}> => {
  if (process.env.BINFLOW_AUTH_SECRET !== undefined) {
    return process.env.BINFLOW_AUTH_SECRET_FILE === undefined
      ? { secret: process.env.BINFLOW_AUTH_SECRET }
      : {
          secret: process.env.BINFLOW_AUTH_SECRET,
          secretFile: process.env.BINFLOW_AUTH_SECRET_FILE,
        };
  }
  return {
    secretFile: process.env.BINFLOW_AUTH_SECRET_FILE ?? defaultAuthSecretPath(),
  };
};

export const getAuthRuntime = (): Promise<BinflowAuthRuntime> => {
  runtime ??= (async () =>
    createBinflowAuthRuntime({
      baseURL: process.env.BINFLOW_PUBLIC_URL ?? 'http://localhost:3000',
      databaseUrl: await readDatabaseUrl(),
      production: process.env.BINFLOW_SECURE_COOKIES === 'true',
      ...authSecretSources(),
      trustedOrigins: [
        process.env.BINFLOW_PUBLIC_URL ?? 'http://localhost:3000',
      ],
    }))().catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
};
