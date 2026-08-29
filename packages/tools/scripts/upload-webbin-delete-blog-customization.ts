#!/usr/bin/env node
/**
 * Upload docs/customizations/webbin-delete-blog-draft.md into the local
 * Webbin project so Dashboard → Customizations shows the active version.
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow_app:binflow_local_app@127.0.0.1:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/upload-webbin-delete-blog-customization.ts
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';

import { createDatabase, schema, withPlatformOwnerScope } from '@binflow/db';
import { ToolCatalogService } from '@binflow/tools';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://binflow_app:binflow_local_app@127.0.0.1:5432/binflow';

const { db: database, pool } = createDatabase(databaseUrl);
const catalog = new ToolCatalogService(database);
const body = await readFile(
  join(root, 'docs/customizations/webbin-delete-blog-draft.md'),
  'utf8',
);

const projects = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:upload-webbin-delete-blog-customization',
    correlationId: 'upload-webbin-delete-blog-customization',
    reason: 'Resolve webbin project for delete-blog customization upload',
  },
  async (scoped) =>
    scoped
      .select({
        projectId: schema.projects.id,
        projectKey: schema.projects.key,
        tenantId: schema.projects.tenantId,
        tenantKey: schema.tenants.key,
      })
      .from(schema.projects)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.projects.tenantId))
      .where(
        and(eq(schema.tenants.key, 'webbin'), eq(schema.projects.key, 'webbin')),
      ),
);

const webbin = projects[0];
if (webbin === undefined) {
  console.error(
    'No webbin tenant/project found. Run scope init for tenant webbin first.',
  );
  await pool.end();
  process.exit(1);
}

const summary = await catalog.uploadCustomization(
  {
    body,
    capabilityId: 'delete_blog_draft',
    projectId: webbin.projectId,
  },
  {
    actorId: 'script:upload-webbin-delete-blog-customization',
    correlationId: `upload-webbin-delete-blog-customization:${Date.now()}`,
    tenantId: webbin.tenantId,
  },
);

console.log(
  JSON.stringify(
    {
      capabilityId: summary.capabilityId,
      projectId: summary.projectId,
      projectKey: webbin.projectKey,
      tenantKey: webbin.tenantKey,
      version: summary.version,
      sha256: summary.sha256,
    },
    null,
    2,
  ),
);

await pool.end();
