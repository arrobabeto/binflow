import { readFile } from 'node:fs/promises';

import { defaultMasterKeyPath } from '@binflow/secrets';

export const databaseUrl = async (): Promise<string> => {
  if (process.env.DATABASE_URL !== undefined) return process.env.DATABASE_URL;
  if (process.env.DATABASE_URL_FILE !== undefined) {
    return (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim();
  }
  return 'postgresql://binflow_app:binflow_local_app@localhost:5432/binflow';
};

export const migrationDatabaseUrl = async (): Promise<string> => {
  if (process.env.BINFLOW_MIGRATION_DATABASE_URL !== undefined) {
    return process.env.BINFLOW_MIGRATION_DATABASE_URL;
  }
  if (process.env.BINFLOW_MIGRATION_DATABASE_URL_FILE !== undefined) {
    return (
      await readFile(process.env.BINFLOW_MIGRATION_DATABASE_URL_FILE, 'utf8')
    ).trim();
  }
  return 'postgresql://binflow:binflow_local@localhost:5432/binflow';
};

export const masterKeyPath = (): string =>
  process.env.BINFLOW_KEK_FILE ?? defaultMasterKeyPath();
