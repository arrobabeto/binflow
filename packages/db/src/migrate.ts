import { readFile } from 'node:fs/promises';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client.js';

export const runMigrations = async (databaseUrl: string): Promise<void> => {
  const { db, pool } = createDatabase(databaseUrl);
  try {
    await migrate(db, {
      migrationsFolder: new URL('../migrations', import.meta.url).pathname,
    });
  } finally {
    await pool.end();
  }
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const databaseUrl =
    process.env.DATABASE_URL ??
    (process.env.DATABASE_URL_FILE === undefined
      ? 'postgresql://binflow:binflow_local@localhost:5432/binflow'
      : (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim());
  await runMigrations(databaseUrl);
}
