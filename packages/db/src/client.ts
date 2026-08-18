import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export const createDatabase = (connectionString: string) => {
  const pool = new Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
};

export type Database = ReturnType<typeof createDatabase>['db'];
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
