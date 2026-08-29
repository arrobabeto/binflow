#!/usr/bin/env node
/**
 * Append delete_project_astro@2 to the active Webbin manifest bindings.
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow:binflow_local@localhost:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/add-webbin-delete-project-binding.ts
 */
import { createHash } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  projectManifestSchema,
  type ProjectManifest,
} from '@binflow/contracts';
import { createDatabase, schema, withPlatformOwnerScope } from '@binflow/db';

const deleteProjectBinding = Object.freeze({
  access: 'client_publish' as const,
  capabilityId: 'delete_project_astro' as const,
  capabilityVersion: 2 as const,
});

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://binflow:binflow_local@localhost:5432/binflow';

const patchManifestDocument = (document: ProjectManifest): ProjectManifest => {
  const hasBinding = document.enabledCapabilities.some(
    (binding) => binding.capabilityId === 'delete_project_astro',
  );
  const enabledCapabilities = hasBinding
    ? document.enabledCapabilities
    : [...document.enabledCapabilities, deleteProjectBinding];
  return projectManifestSchema.parse({
    ...document,
    enabledCapabilities,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          enabledCapabilities,
          prior: document.fingerprint,
          reason: 'add-webbin-delete-project-binding',
        }),
      )
      .digest('hex'),
  });
};

const { db: database, pool } = createDatabase(databaseUrl);

const result = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:add-webbin-delete-project-binding',
    correlationId: `add-webbin-delete-project-binding:${Date.now()}`,
    reason: 'Enable delete_project_astro on Webbin manifest',
  },
  async (scoped) => {
    const projects = await scoped
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
      );
    const webbin = projects[0];
    if (webbin === undefined)
      throw new Error(
        'No webbin tenant/project found. Run scope init for tenant webbin first.',
      );

    const [latest] = await scoped
      .select()
      .from(schema.projectManifestVersions)
      .where(
        and(
          eq(schema.projectManifestVersions.projectId, webbin.projectId),
          eq(schema.projectManifestVersions.tenantId, webbin.tenantId),
          inArray(schema.projectManifestVersions.status, [
            'active',
            'validated',
          ]),
        ),
      )
      .orderBy(desc(schema.projectManifestVersions.version))
      .limit(1);
    if (latest === undefined)
      throw new Error('No active/validated Webbin manifest revision found.');

    const previous = projectManifestSchema.parse(latest.document);
    if (
      previous.enabledCapabilities.some(
        (binding) => binding.capabilityId === 'delete_project_astro',
      )
    ) {
      return {
        action: 'noop',
        enabledCapabilities: previous.enabledCapabilities,
        manifestVersionId: latest.id,
        projectId: webbin.projectId,
        tenantKey: webbin.tenantKey,
        version: latest.version,
      };
    }

    const patched = patchManifestDocument({
      ...previous,
      id: uuidv7(),
      status: 'active',
      validatedAt: new Date().toISOString(),
      version: latest.version + 1,
    });

    const now = new Date();
    await scoped
      .update(schema.projectManifestVersions)
      .set({ status: 'superseded', supersededAt: now })
      .where(eq(schema.projectManifestVersions.id, latest.id));

    await scoped.insert(schema.projectManifestVersions).values({
      createdBy: 'script:add-webbin-delete-project-binding',
      dependencyFingerprint: patched.fingerprint,
      document: patched,
      globalProfileVersion: patched.globalProfileVersion,
      id: patched.id,
      profile: patched.profile,
      projectId: webbin.projectId,
      status: 'active',
      tenantId: webbin.tenantId,
      validatedAt: now,
      version: patched.version,
    });

    const [locale] = await scoped
      .select()
      .from(schema.projectLocales)
      .where(eq(schema.projectLocales.manifestVersionId, latest.id))
      .limit(1);
    if (locale !== undefined)
      await scoped.insert(schema.projectLocales).values({
        contentLocales: locale.contentLocales,
        conversationLocale: locale.conversationLocale,
        defaultContentLocale: locale.defaultContentLocale,
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: webbin.projectId,
        requiredContentLocales: locale.requiredContentLocales,
        slugLocale: locale.slugLocale,
        tenantId: webbin.tenantId,
        translationPolicy: locale.translationPolicy,
      });

    const [budget] = await scoped
      .select()
      .from(schema.projectBudgetPolicies)
      .where(eq(schema.projectBudgetPolicies.manifestVersionId, latest.id))
      .limit(1);
    if (budget !== undefined)
      await scoped.insert(schema.projectBudgetPolicies).values({
        id: uuidv7(),
        manifestVersionId: patched.id,
        maxEstimatedCostCentsPerDay: budget.maxEstimatedCostCentsPerDay,
        maxEstimatedCostCentsPerRequest: budget.maxEstimatedCostCentsPerRequest,
        maxModelCallsPerRequest: budget.maxModelCallsPerRequest,
        maxRequestsPerDay: budget.maxRequestsPerDay,
        maxTokensPerRequest: budget.maxTokensPerRequest,
        projectId: webbin.projectId,
        tenantId: webbin.tenantId,
      });

    const bindings = await scoped
      .select()
      .from(schema.projectCapabilityBindings)
      .where(eq(schema.projectCapabilityBindings.manifestVersionId, latest.id));
    for (const binding of bindings) {
      await scoped.insert(schema.projectCapabilityBindings).values({
        access: binding.access,
        capabilityId: binding.capabilityId,
        capabilityVersion: binding.capabilityVersion,
        createdBy: 'script:add-webbin-delete-project-binding',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: webbin.projectId,
        tenantId: webbin.tenantId,
      });
    }

    await scoped.insert(schema.projectCapabilityBindings).values({
      access: deleteProjectBinding.access,
      capabilityId: deleteProjectBinding.capabilityId,
      capabilityVersion: deleteProjectBinding.capabilityVersion,
      createdBy: 'script:add-webbin-delete-project-binding',
      id: uuidv7(),
      manifestVersionId: patched.id,
      projectId: webbin.projectId,
      tenantId: webbin.tenantId,
    });

    return {
      action: 'bumped',
      enabledCapabilities: patched.enabledCapabilities,
      manifestVersionId: patched.id,
      previousManifestVersionId: latest.id,
      projectId: webbin.projectId,
      tenantKey: webbin.tenantKey,
      version: patched.version,
    };
  },
);

console.log(JSON.stringify(result, null, 2));
await pool.end();
