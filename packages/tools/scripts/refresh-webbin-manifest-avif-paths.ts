#!/usr/bin/env node
/**
 * Force-bump the active Webbin project manifest so portfolio covers may write
 * both `*.jpg` and `*.avif` under public/images/projects (ADR-0037 path boundary).
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow_app:binflow_local_app@127.0.0.1:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/refresh-webbin-manifest-avif-paths.ts
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

const JPG_GLOB = 'public/images/projects/*.jpg';
const AVIF_GLOB = 'public/images/projects/*.avif';

const ensureDualProjectImageGlobs = (
  paths: readonly string[],
): string[] => {
  const next = [...paths];
  const insertAfterMd = (glob: string): void => {
    if (next.includes(glob)) return;
    const lastMd = [...next]
      .map((path, index) => ({ index, path }))
      .reverse()
      .find((entry) => entry.path.endsWith('*.md'));
    if (lastMd === undefined) next.push(glob);
    else next.splice(lastMd.index + 1, 0, glob);
  };
  insertAfterMd(JPG_GLOB);
  insertAfterMd(AVIF_GLOB);
  // Prefer jpg then avif adjacent at the end of image globs.
  const withoutImages = next.filter(
    (path) => path !== JPG_GLOB && path !== AVIF_GLOB,
  );
  return [...withoutImages, JPG_GLOB, AVIF_GLOB];
};

const patchManifestDocument = (document: ProjectManifest): ProjectManifest => {
  const contentPaths = ensureDualProjectImageGlobs(document.content.editablePaths);
  const portfolio = document.content.portfolio;
  if (portfolio === undefined)
    throw new Error('Webbin manifest is missing content.portfolio.');
  const portfolioPaths = ensureDualProjectImageGlobs(portfolio.editablePaths);
  return projectManifestSchema.parse({
    ...document,
    content: {
      ...document.content,
      editablePaths: contentPaths,
      portfolio: {
        ...portfolio,
        editablePaths: portfolioPaths,
      },
    },
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          prior: document.fingerprint,
          contentEditablePaths: contentPaths,
          portfolioEditablePaths: portfolioPaths,
          reason: 'refresh-webbin-manifest-avif-paths',
        }),
      )
      .digest('hex'),
  });
};

const { db: database, pool } = createDatabase(databaseUrl);

const result = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:refresh-webbin-manifest-avif-paths',
    correlationId: `refresh-webbin-manifest-avif-paths:${Date.now()}`,
    reason: 'Force-bump Webbin manifest editablePaths for AVIF covers',
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

    const alreadyReady =
      previous.content.editablePaths.includes(AVIF_GLOB) &&
      previous.content.portfolio?.editablePaths.includes(AVIF_GLOB) &&
      previous.content.editablePaths.includes(JPG_GLOB) &&
      previous.content.portfolio?.editablePaths.includes(JPG_GLOB);
    if (alreadyReady && latest.status === 'active') {
      return {
        action: 'noop',
        manifestVersionId: latest.id,
        projectId: webbin.projectId,
        tenantKey: webbin.tenantKey,
        version: latest.version,
        contentEditablePaths: previous.content.editablePaths,
        portfolioEditablePaths: previous.content.portfolio?.editablePaths,
      };
    }

    const now = new Date();
    await scoped
      .update(schema.projectManifestVersions)
      .set({ status: 'superseded', supersededAt: now })
      .where(eq(schema.projectManifestVersions.id, latest.id));

    await scoped.insert(schema.projectManifestVersions).values({
      createdBy: 'script:refresh-webbin-manifest-avif-paths',
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
        createdBy: 'script:refresh-webbin-manifest-avif-paths',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: webbin.projectId,
        tenantId: webbin.tenantId,
      });
    }

    return {
      action: 'bumped',
      manifestVersionId: patched.id,
      previousManifestVersionId: latest.id,
      projectId: webbin.projectId,
      tenantKey: webbin.tenantKey,
      version: patched.version,
      contentEditablePaths: patched.content.editablePaths,
      portfolioEditablePaths: patched.content.portfolio?.editablePaths,
    };
  },
);

console.log(JSON.stringify(result, null, 2));
await pool.end();
