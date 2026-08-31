#!/usr/bin/env node
/**
 * Force-bump the active Bistro (astro_orbitype) manifest so blog markdown
 * editablePaths use `blog-{locale}/*.md`, collections use `/posts` routePrefix,
 * and deployment.productionOrigin mirrors enrollment productionDomain (ADR-0048).
 *
 * Usage:
 *   DATABASE_URL=postgresql://binflow:binflow_local@localhost:5432/binflow \
 *     pnpm --filter @binflow/tools exec tsx scripts/refresh-bistro-manifest-blog-paths.ts
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
  'postgresql://binflow:binflow_local@localhost:5432/binflow';

const TARGET_PATHS = [
  'cms/collections/**',
  'public/documents/*.pdf',
  'src/content/blog-en/*.md',
  'src/content/blog-es/*.md',
  'src/content/blog-de/*.md',
  'public/images/blog/*.avif',
  'public/images/blog/*.jpg',
  'public/images/blog/*.png',
  'public/images/blog/*.webp',
] as const;

const normalizeOrigin = (value: string): string => {
  const url = new URL(value);
  return `https://${url.host}`;
};

const patchManifestDocument = (
  document: ProjectManifest,
  productionOrigin: string,
): ProjectManifest => {
  const contentPaths = [...TARGET_PATHS];
  const collections = Object.fromEntries(
    Object.entries(document.content.collections ?? {}).map(
      ([locale, collection]) => [
        locale,
        {
          ...collection,
          routePrefix: '/posts',
        },
      ],
    ),
  );
  return projectManifestSchema.parse({
    ...document,
    content: {
      ...document.content,
      collections,
      editablePaths: contentPaths,
      imageDirectory: 'public/images/blog',
      publicationTargets: document.content.publicationTargets ?? [
        'github',
        'orbitype',
      ],
      source: document.content.source ?? 'orbitype',
    },
    deployment: {
      ...document.deployment,
      productionOrigin,
    },
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          prior: document.fingerprint,
          contentEditablePaths: contentPaths,
          productionOrigin,
          routePrefix: '/posts',
          reason: 'refresh-bistro-manifest-blog-paths',
        }),
      )
      .digest('hex'),
  });
};

const pathsReady = (
  document: ProjectManifest,
  productionOrigin: string,
): boolean => {
  const paths = document.content.editablePaths;
  const pathsOk =
    TARGET_PATHS.every((path) => paths.includes(path)) &&
    !paths.some((path) => path.includes('blog-') && path.includes('/**/'));
  const collections = document.content.collections ?? {};
  const routesOk = Object.values(collections).every(
    (collection) => collection.routePrefix === '/posts',
  );
  const originOk = document.deployment.productionOrigin === productionOrigin;
  return (
    pathsOk && routesOk && originOk && Object.keys(collections).length > 0
  );
};

const { db: database, pool } = createDatabase(databaseUrl);

const result = await withPlatformOwnerScope(
  database,
  {
    actorId: 'script:refresh-bistro-manifest-blog-paths',
    correlationId: `refresh-bistro-manifest-blog-paths:${Date.now()}`,
    reason: 'Force-bump Bistro manifest editablePaths for blog render',
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

    const [enrollment] = await scoped
      .select({ configuration: schema.clientEnrollments.configuration })
      .from(schema.clientEnrollments)
      .where(
        and(
          eq(schema.clientEnrollments.projectId, bistro.projectId),
          eq(schema.clientEnrollments.tenantId, bistro.tenantId),
          eq(schema.clientEnrollments.state, 'active'),
        ),
      )
      .orderBy(desc(schema.clientEnrollments.createdAt))
      .limit(1);
    const domain = (
      enrollment?.configuration as { productionDomain?: string } | null
    )?.productionDomain;
    if (typeof domain !== 'string' || domain.trim().length === 0)
      throw new Error(
        'Active Bistro enrollment is missing productionDomain.',
      );
    const productionOrigin = normalizeOrigin(domain);

    const previous = projectManifestSchema.parse(latest.document);
    if (pathsReady(previous, productionOrigin)) {
      return {
        action: 'noop',
        contentEditablePaths: previous.content.editablePaths,
        manifestVersionId: latest.id,
        productionOrigin: previous.deployment.productionOrigin,
        projectId: bistro.projectId,
        routePrefixes: Object.fromEntries(
          Object.entries(previous.content.collections ?? {}).map(
            ([locale, collection]) => [locale, collection.routePrefix],
          ),
        ),
        tenantKey: bistro.tenantKey,
        version: latest.version,
      };
    }

    const patched = patchManifestDocument(
      {
        ...previous,
        id: uuidv7(),
        status: latest.status === 'active' ? 'active' : 'validated',
        validatedAt: new Date().toISOString(),
        version: latest.version + 1,
      },
      productionOrigin,
    );

    const now = new Date();
    await scoped
      .update(schema.projectManifestVersions)
      .set({ status: 'superseded', supersededAt: now })
      .where(eq(schema.projectManifestVersions.id, latest.id));

    await scoped.insert(schema.projectManifestVersions).values({
      createdBy: 'script:refresh-bistro-manifest-blog-paths',
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
        createdBy: 'script:refresh-bistro-manifest-blog-paths',
        id: uuidv7(),
        manifestVersionId: patched.id,
        projectId: bistro.projectId,
        tenantId: bistro.tenantId,
      });
    }

    return {
      action: 'bumped',
      contentEditablePaths: patched.content.editablePaths,
      manifestVersionId: patched.id,
      previousManifestVersionId: latest.id,
      productionOrigin: patched.deployment.productionOrigin,
      projectId: bistro.projectId,
      tenantKey: bistro.tenantKey,
      version: patched.version,
    };
  },
);

console.log(JSON.stringify(result, null, 2));
await pool.end();
