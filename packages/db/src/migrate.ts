import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import * as schema from './schema.js';

export const runMigrations = async (databaseUrl: string): Promise<void> => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const db = drizzle(pool, { schema });
  let locked = false;
  try {
    await db.execute(
      sql`select pg_advisory_lock(hashtext('binflow_schema_migrations'))`,
    );
    locked = true;
    await migrate(db, {
      migrationsFolder: new URL('../migrations', import.meta.url).pathname,
    });
  } finally {
    try {
      if (locked) {
        await db.execute(
          sql`select pg_advisory_unlock(hashtext('binflow_schema_migrations'))`,
        );
      }
    } finally {
      await pool.end();
    }
  }
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const databaseUrl =
    process.env.BINFLOW_MIGRATION_DATABASE_URL ??
    (process.env.BINFLOW_MIGRATION_DATABASE_URL_FILE === undefined
      ? 'postgresql://binflow:binflow_local@localhost:5432/binflow'
      : (
          await readFile(
            process.env.BINFLOW_MIGRATION_DATABASE_URL_FILE,
            'utf8',
          )
        ).trim());
  await runMigrations(databaseUrl);
}
