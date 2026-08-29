#!/usr/bin/env node
/**
 * Force-bump the active Webbin project manifest so blog deletions may upsert
 * `public/_redirects` (delete_blog_draft redirect verification).
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow_app:binflow_local_app@127.0.0.1:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/refresh-webbin-manifest-redirects-path.ts
 */
import { createHash } from 'node:crypto';

import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import {
  projectManifestSchema,
  type ProjectManifest,
} from '@binflow/contracts';
import { createDatabase, schema, withPlatformOwnerScope } from '@binflow/db';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://binflow_app:binflow_local_app@127.0.0.1:5432/binflow';

const REDIRECTS_PATH = 'public/_redirects';

const ensureRedirectsEditablePath = (paths: readonly string[]): string[] => {
  if (paths.includes(REDIRECTS_PATH)) return [...paths];
  const articlesAvif = paths.findIndex(
    (path) => path === 'public/images/articles/*.avif',
  );
  if (articlesAvif >= 0) {
    const next = [...paths];
    next.splice(articlesAvif + 1, 0, REDIRECTS_PATH);
    return next;
  }
  return [...paths, REDIRECTS_PATH];
};

const patchManifestDocument = (document: ProjectManifest): ProjectManifest => {
  const contentPaths = ensureRedirectsEditablePath(document.content.editablePaths);
  const enabledCapabilities = document.enabledCapabilities.map((binding) =>
    binding.capabilityId === 'delete_blog_draft'
      ? { ...binding, capabilityVersion: 2 as const }
      : binding,
  );
  return projectManifestSchema.parse({
    ...document,
    content: {
      ...document.content,
      editablePaths: contentPaths,
    },
    enabledCapabilities,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          prior: document.fingerprint,
          contentEditablePaths: contentPaths,
          enabledCapabilities,
          reason: 'refresh-webbin-manifest-redirects-path',
        }),
      )
      .digest('hex'),
  });
};

const { db: database, pool } = createDatabase(databaseUrl);

const result = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:refresh-webbin-manifest-redirects-path',
    correlationId: `refresh-webbin-manifest-redirects-path:${Date.now()}`,
    reason: 'Force-bump Webbin manifest editablePaths for deletion redirects',
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
    const patched = patchManifestDocument({
      ...previous,
      id: uuidv7(),
      status: 'active',
      validatedAt: new Date().toISOString(),
      version: latest.version + 1,
    });

    if (
      previous.content.editablePaths.includes(REDIRECTS_PATH) &&
      previous.enabledCapabilities.some(
        (binding) =>
          binding.capabilityId === 'delete_blog_draft' &&
          binding.capabilityVersion === 2,
      ) &&
      latest.status === 'active'
    ) {
      return {
        action: 'noop',
        contentEditablePaths: previous.content.editablePaths,
        manifestVersionId: latest.id,
        projectId: webbin.projectId,
        tenantKey: webbin.tenantKey,
        version: latest.version,
      };
    }

    const now = new Date();
    await scoped
      .update(schema.projectManifestVersions)
      .set({ status: 'superseded', supersededAt: now })
      .where(eq(schema.projectManifestVersions.id, latest.id));

    await scoped.insert(schema.projectManifestVersions).values({
      createdBy: 'script:refresh-webbin-manifest-redirects-path',
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
        capabilityVersion:
          binding.capabilityId === 'delete_blog_draft'
            ? 2
            : binding.capabilityVersion,
        createdBy: 'script:refresh-webbin-manifest-redirects-path',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: webbin.projectId,
        tenantId: webbin.tenantId,
      });
    }

    return {
      action: 'bumped',
      contentEditablePaths: patched.content.editablePaths,
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
