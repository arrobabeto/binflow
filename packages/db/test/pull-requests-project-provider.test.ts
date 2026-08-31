import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

const databaseUrl = process.env.BINFLOW_TEST_DATABASE_URL;
if (
  databaseUrl !== undefined &&
  !new URL(databaseUrl).pathname.slice(1).endsWith('_test')
) {
  throw new Error(
    'BINFLOW_TEST_DATABASE_URL must name a database ending in _test.',
  );
}
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase('pull_requests project-scoped provider uniqueness', () => {
  const owner = createDatabase(databaseUrl!);

  beforeAll(async () => {
    await runMigrations(databaseUrl!);
  });

  afterAll(async () => {
    await owner.pool.end();
  });

  it('scopes provider_id uniqueness to project_id', async () => {
    const indexes = await owner.db.execute(sql`
      select indexname, indexdef
      from pg_indexes
      where tablename = 'pull_requests'
        and indexname in (
          'pull_requests_provider_id_unique',
          'pull_requests_project_provider_unique'
        )
      order by indexname
    `);
    const names = (indexes.rows as Array<{ indexname: string }>).map(
      (row) => row.indexname,
    );
    expect(names).not.toContain('pull_requests_provider_id_unique');
    expect(names).toContain('pull_requests_project_provider_unique');
    const def = (
      indexes.rows as Array<{ indexname: string; indexdef: string }>
    ).find((row) => row.indexname === 'pull_requests_project_provider_unique');
    expect(def?.indexdef).toMatch(/project_id/iu);
    expect(def?.indexdef).toMatch(/provider_id/iu);
  });
});
