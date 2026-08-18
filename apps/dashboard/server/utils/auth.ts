import { readFile } from 'node:fs/promises';

import { createBinflowAuthRuntime } from '@binflow/auth';

let runtime: ReturnType<typeof createBinflowAuthRuntime> | undefined;

const readDatabaseUrl = async (): Promise<string> => {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL;
  if (process.env.DATABASE_URL_FILE !== undefined) {
    return (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
  }
  return 'postgresql://binflow_app:binflow_local_app@localhost:5432/binflow';
};

export const getAuthRuntime = () => {
  runtime ??= (async () =>
    createBinflowAuthRuntime({
      baseURL: process.env.BINFLOW_PUBLIC_URL ?? 'http://localhost:3000',
      databaseUrl: await readDatabaseUrl(),
      production: process.env.BINFLOW_SECURE_COOKIES === 'true',
      ...(process.env.BINFLOW_AUTH_SECRET === undefined
        ? {}
        : { secret: process.env.BINFLOW_AUTH_SECRET }),
      ...(process.env.BINFLOW_AUTH_SECRET_FILE === undefined
        ? {}
        : { secretFile: process.env.BINFLOW_AUTH_SECRET_FILE }),
      trustedOrigins: [
        process.env.BINFLOW_PUBLIC_URL ?? 'http://localhost:3000',
      ],
    }))();
  return runtime;
};
