#!/usr/bin/env node
/**
 * Upload docs/customizations/bistro-update-menu.md into the local Bistro project.
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow:binflow_local@localhost:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/upload-bistro-update-menu-customization.ts
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
  'postgresql://binflow:binflow_local@localhost:5432/binflow';

const { db: database, pool } = createDatabase(databaseUrl);
const catalog = new ToolCatalogService(database);
const body = await readFile(
  join(root, 'docs/customizations/bistro-update-menu.md'),
  'utf8',
);

const projects = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:upload-bistro-update-menu-customization',
    correlationId: 'upload-bistro-update-menu-customization',
    reason: 'Resolve bistro project for update_menu customization upload',
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
        and(
          eq(schema.tenants.key, 'bistro'),
          eq(schema.projects.key, 'bistro'),
          eq(schema.projects.profile, 'astro_orbitype'),
        ),
      ),
);

const bistro = projects[0];
if (bistro === undefined) {
  console.error('No bistro astro_orbitype project found.');
  await pool.end();
  process.exit(1);
}

const summary = await catalog.uploadCustomization(
  {
    body,
    capabilityId: 'update_menu',
    projectId: bistro.projectId,
  },
  {
    actorId: 'script:upload-bistro-update-menu-customization',
    correlationId: `upload-bistro-update-menu-customization:${Date.now()}`,
    tenantId: bistro.tenantId,
  },
);

console.log(
  JSON.stringify(
    {
      capabilityId: summary.capabilityId,
      projectId: summary.projectId,
      projectKey: bistro.projectKey,
      tenantKey: bistro.tenantKey,
      version: summary.version,
    },
    null,
    2,
  ),
);
await pool.end();
