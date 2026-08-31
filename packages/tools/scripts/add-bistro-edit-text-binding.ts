#!/usr/bin/env node
/**
 * Append edit_text@1 to the active Bistro (astro_orbitype) manifest bindings.
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow:binflow_local@localhost:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/add-bistro-edit-text-binding.ts
 */
import { createHash } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  projectManifestSchema,
  type ProjectManifest,
} from '@binflow/contracts';
import { createDatabase, schema, withPlatformOwnerScope } from '@binflow/db';

const editTextBinding = Object.freeze({
  access: 'client_publish' as const,
  capabilityId: 'edit_text' as const,
  capabilityVersion: 1 as const,
});

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://binflow:binflow_local@localhost:5432/binflow';

const patchManifestDocument = (document: ProjectManifest): ProjectManifest => {
  const hasBinding = document.enabledCapabilities.some(
    (binding) => binding.capabilityId === 'edit_text',
  );
  const enabledCapabilities = hasBinding
    ? document.enabledCapabilities
    : [...document.enabledCapabilities, editTextBinding];
  return projectManifestSchema.parse({
    ...document,
    enabledCapabilities,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          enabledCapabilities,
          prior: document.fingerprint,
          reason: 'add-bistro-edit-text-binding',
        }),
      )
      .digest('hex'),
  });
};

const { db: database, pool } = createDatabase(databaseUrl);

const result = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:add-bistro-edit-text-binding',
    correlationId: `add-bistro-edit-text-binding:${Date.now()}`,
    reason: 'Enable edit_text on Bistro manifest',
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
        and(
          eq(schema.tenants.key, 'bistro'),
          eq(schema.projects.key, 'bistro'),
          eq(schema.projects.profile, 'astro_orbitype'),
        ),
      );
    const bistro = projects[0];
    if (bistro === undefined)
      throw new Error(
        'No bistro tenant/project found. Enroll astro_orbitype Bistro first.',
      );

    const [latest] = await scoped
      .select()
      .from(schema.projectManifestVersions)
      .where(
        and(
          eq(schema.projectManifestVersions.projectId, bistro.projectId),
          eq(schema.projectManifestVersions.tenantId, bistro.tenantId),
          inArray(schema.projectManifestVersions.status, [
            'active',
            'validated',
          ]),
        ),
      )
      .orderBy(desc(schema.projectManifestVersions.version))
      .limit(1);
    if (latest === undefined)
      throw new Error('No active/validated Bistro manifest revision found.');

    const previous = projectManifestSchema.parse(latest.document);
    if (
      previous.enabledCapabilities.some(
        (binding) => binding.capabilityId === 'edit_text',
      )
    ) {
      return {
        action: 'noop',
        enabledCapabilities: previous.enabledCapabilities,
        manifestVersionId: latest.id,
        projectId: bistro.projectId,
        tenantKey: bistro.tenantKey,
        version: latest.version,
      };
    }

    const patched = patchManifestDocument({
      ...previous,
      id: uuidv7(),
      status: latest.status === 'active' ? 'active' : 'validated',
      validatedAt: new Date().toISOString(),
      version: latest.version + 1,
    });

    const now = new Date();
    await scoped
      .update(schema.projectManifestVersions)
      .set({ status: 'superseded', supersededAt: now })
      .where(eq(schema.projectManifestVersions.id, latest.id));

    await scoped.insert(schema.projectManifestVersions).values({
      createdBy: 'script:add-bistro-edit-text-binding',
      dependencyFingerprint: patched.fingerprint,
      document: patched,
      globalProfileVersion: patched.globalProfileVersion,
      id: patched.id,
      profile: patched.profile,
      projectId: bistro.projectId,
      status: patched.status,
      tenantId: bistro.tenantId,
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
        projectId: bistro.projectId,
        requiredContentLocales: locale.requiredContentLocales,
        slugLocale: locale.slugLocale,
        tenantId: bistro.tenantId,
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
        projectId: bistro.projectId,
        tenantId: bistro.tenantId,
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
        createdBy: 'script:add-bistro-edit-text-binding',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: bistro.projectId,
        tenantId: bistro.tenantId,
      });
    }

    await scoped.insert(schema.projectCapabilityBindings).values({
      access: editTextBinding.access,
      capabilityId: editTextBinding.capabilityId,
      capabilityVersion: editTextBinding.capabilityVersion,
      createdBy: 'script:add-bistro-edit-text-binding',
      id: uuidv7(),
      manifestVersionId: patched.id,
      projectId: bistro.projectId,
      tenantId: bistro.tenantId,
    });

    return {
      action: 'bumped',
      enabledCapabilities: patched.enabledCapabilities,
      manifestVersionId: patched.id,
      previousManifestVersionId: latest.id,
      projectId: bistro.projectId,
      tenantKey: bistro.tenantKey,
      version: patched.version,
    };
  },
);

console.log(JSON.stringify(result, null, 2));
await pool.end();
