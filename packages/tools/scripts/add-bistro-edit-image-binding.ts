#!/usr/bin/env node
/**
 * Bump Bistro manifest: add edit_image@1 binding and expand blog image
 * editablePaths (png/webp) so edit_image writes under public/images/blog/.
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow:binflow_local@localhost:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/add-bistro-edit-image-binding.ts
 */
import { createHash } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  projectManifestSchema,
  type ProjectManifest,
} from '@binflow/contracts';
import { createDatabase, schema, withPlatformOwnerScope } from '@binflow/db';

const editImageBinding = Object.freeze({
  access: 'client_publish' as const,
  capabilityId: 'edit_image' as const,
  capabilityVersion: 1 as const,
});

const REQUIRED_IMAGE_PATHS = [
  'public/images/blog/*.avif',
  'public/images/blog/*.jpg',
  'public/images/blog/*.png',
  'public/images/blog/*.webp',
] as const;

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://binflow:binflow_local@localhost:5432/binflow';

const patchManifestDocument = (document: ProjectManifest): ProjectManifest => {
  const pathSet = new Set(document.content.editablePaths);
  for (const path of REQUIRED_IMAGE_PATHS) pathSet.add(path);
  // Keep menu PDF allowlist if previously present or for update_menu.
  pathSet.add('public/documents/*.pdf');
  const editablePaths = [...pathSet];
  const hasBinding = document.enabledCapabilities.some(
    (binding) => binding.capabilityId === 'edit_image',
  );
  const enabledCapabilities = hasBinding
    ? document.enabledCapabilities
    : [...document.enabledCapabilities, editImageBinding];
  return projectManifestSchema.parse({
    ...document,
    content: {
      ...document.content,
      editablePaths,
      imageDirectory: 'public/images/blog',
    },
    enabledCapabilities,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          editablePaths,
          enabledCapabilities,
          prior: document.fingerprint,
          reason: 'add-bistro-edit-image-binding',
        }),
      )
      .digest('hex'),
  });
};

const { db: database, pool } = createDatabase(databaseUrl);

const result = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:add-bistro-edit-image-binding',
    correlationId: `add-bistro-edit-image-binding:${Date.now()}`,
    reason: 'Enable edit_image and expand blog image editablePaths on Bistro',
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
    const pathsReady = REQUIRED_IMAGE_PATHS.every((path) =>
      previous.content.editablePaths.includes(path),
    );
    const bindingReady = previous.enabledCapabilities.some(
      (binding) => binding.capabilityId === 'edit_image',
    );
    if (pathsReady && bindingReady) {
      return {
        action: 'noop',
        editablePaths: previous.content.editablePaths,
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
      createdBy: 'script:add-bistro-edit-image-binding',
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
        createdBy: 'script:add-bistro-edit-image-binding',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: bistro.projectId,
        tenantId: bistro.tenantId,
      });
    }

    if (!bindingReady)
      await scoped.insert(schema.projectCapabilityBindings).values({
        access: editImageBinding.access,
        capabilityId: editImageBinding.capabilityId,
        capabilityVersion: editImageBinding.capabilityVersion,
        createdBy: 'script:add-bistro-edit-image-binding',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: bistro.projectId,
        tenantId: bistro.tenantId,
      });

    return {
      action: 'bumped',
      editablePaths: patched.content.editablePaths,
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
