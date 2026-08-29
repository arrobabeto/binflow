import { readFile } from 'node:fs/promises';

import {
  createBinflowAuthRuntime,
  defaultAuthSecretPath,
  type BinflowAuthRuntime,
} from '@binflow/auth';

const readDatabaseUrl = async (): Promise<string> => {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL;
  if (process.env.DATABASE_URL_FILE !== undefined) {
    return (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
  }
  return 'postgresql://binflow_app:binflow_local_app@localhost:5432/binflow';
};

export const createApiAuthRuntime = async (): Promise<BinflowAuthRuntime> =>
  createBinflowAuthRuntime({
    baseURL: process.env.BINFLOW_PUBLIC_URL ?? 'http://localhost:3000',
    databaseUrl: await readDatabaseUrl(),
    production: process.env.BINFLOW_SECURE_COOKIES === 'true',
    ...(process.env.BINFLOW_AUTH_SECRET === undefined
      ? {
          secretFile:
            process.env.BINFLOW_AUTH_SECRET_FILE ?? defaultAuthSecretPath(),
        }
      : { secret: process.env.BINFLOW_AUTH_SECRET }),
    ...(process.env.BINFLOW_AUTH_SECRET !== undefined &&
    process.env.BINFLOW_AUTH_SECRET_FILE !== undefined
      ? { secretFile: process.env.BINFLOW_AUTH_SECRET_FILE }
      : {}),
    trustedOrigins: [process.env.BINFLOW_PUBLIC_URL ?? 'http://localhost:3000'],
  });
