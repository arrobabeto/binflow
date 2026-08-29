import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { CatalogItem as BlogCatalogItem } from '@binflow/blog';
import { portfolioCatalogItems, type CatalogItem as ProjectCatalogItem } from '@binflow/projects';
import type { ProjectManifest } from '@binflow/contracts';
import { schema, type ScopedDatabase } from '@binflow/db';

const normalizeTitle = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export type DeleteBlogCatalogLoader = (
  input: Readonly<{
    database: ScopedDatabase;
    manifest: ProjectManifest;
    projectId: string;
    tenantId: string;
  }>,
) => Promise<readonly BlogCatalogItem[]>;

export type DeleteProjectCatalogLoader = (
  input: Readonly<{
    database: ScopedDatabase;
    manifest: ProjectManifest;
    projectId: string;
    tenantId: string;
  }>,
) => Promise<readonly ProjectCatalogItem[]>;

export const filterBlogCatalogItems = (
  items: readonly BlogCatalogItem[],
  manifest: ProjectManifest,
): readonly BlogCatalogItem[] => {
  const blogDirectories = new Set(
    Object.values(manifest.content.collections).flatMap((collection) =>
      collection === undefined ? [] : [collection.directory],
    ),
  );
  return items.filter((item) =>
    [...blogDirectories].some((directory) =>
      item.sourceId.startsWith(`${directory}/`),
    ),
  );
};

export const filterPortfolioCatalogItems = (
  items: readonly ProjectCatalogItem[],
  manifest: ProjectManifest,
): readonly ProjectCatalogItem[] => portfolioCatalogItems(manifest, items);

export const persistDeleteBlogCatalogSync = async (
  database: ScopedDatabase,
  input: Readonly<{
    items: readonly BlogCatalogItem[];
    manifest: ProjectManifest;
    projectId: string;
    revision: string;
    tenantId: string;
  }>,
): Promise<void> => {
  const blogItems = filterBlogCatalogItems(input.items, input.manifest);
  const now = new Date();
  const [catalogSync] = await database
    .insert(schema.contentCatalogSyncs)
    .values({
      completedAt: now,
      id: uuidv7(),
      itemCount: blogItems.length,
      projectId: input.projectId,
      sourceRevision: input.revision,
      status: 'completed',
      tenantId: input.tenantId,
    })
    .onConflictDoUpdate({
      set: {
        completedAt: now,
        itemCount: blogItems.length,
        status: 'completed',
      },
      target: [
        schema.contentCatalogSyncs.projectId,
        schema.contentCatalogSyncs.sourceRevision,
      ],
    })
    .returning({ id: schema.contentCatalogSyncs.id });
  if (catalogSync === undefined) return;

  for (const item of blogItems) {
    await database
      .insert(schema.contentCatalogItems)
      .values({
        category: item.category,
        contentHash: item.contentHash,
        id: uuidv7(),
        locale: item.locale,
        normalizedTitle: normalizeTitle(item.title),
        projectId: input.projectId,
        slug: item.slug,
        sourceId: item.sourceId,
        sourceRevision: item.sourceRevision,
        syncId: catalogSync.id,
        tenantId: input.tenantId,
        title: item.title,
      })
      .onConflictDoUpdate({
        set: {
          category: item.category,
          contentHash: item.contentHash,
          normalizedTitle: normalizeTitle(item.title),
          slug: item.slug,
          sourceRevision: item.sourceRevision,
          status: 'published',
          syncId: catalogSync.id,
          title: item.title,
          updatedAt: now,
        },
        target: [
          schema.contentCatalogItems.projectId,
          schema.contentCatalogItems.sourceId,
          schema.contentCatalogItems.locale,
        ],
      });
  }

  const activeKeys = new Set(
    blogItems.map((item) => `${item.sourceId}\0${item.locale}`),
  );
  const blogDirectories = [
    ...new Set(
      Object.values(input.manifest.content.collections).flatMap((collection) =>
        collection === undefined ? [] : [collection.directory],
      ),
    ),
  ];
  const publishedRows = await database
    .select({
      locale: schema.contentCatalogItems.locale,
      sourceId: schema.contentCatalogItems.sourceId,
    })
    .from(schema.contentCatalogItems)
    .where(
      and(
        eq(schema.contentCatalogItems.projectId, input.projectId),
        eq(schema.contentCatalogItems.status, 'published'),
      ),
    );
  for (const row of publishedRows) {
    if (
      !blogDirectories.some((directory) => row.sourceId.startsWith(`${directory}/`))
    )
      continue;
    if (activeKeys.has(`${row.sourceId}\0${row.locale}`)) continue;
    await database
      .update(schema.contentCatalogItems)
      .set({ status: 'deleted', updatedAt: now })
      .where(
        and(
          eq(schema.contentCatalogItems.projectId, input.projectId),
          eq(schema.contentCatalogItems.sourceId, row.sourceId),
          eq(schema.contentCatalogItems.locale, row.locale),
        ),
      );
  }
};

export const persistDeleteProjectCatalogSync = async (
  database: ScopedDatabase,
  input: Readonly<{
    items: readonly ProjectCatalogItem[];
    manifest: ProjectManifest;
    projectId: string;
    revision: string;
    tenantId: string;
  }>,
): Promise<void> => {
  const portfolioItems = filterPortfolioCatalogItems(input.items, input.manifest);
  const now = new Date();
  const [catalogSync] = await database
    .insert(schema.contentCatalogSyncs)
    .values({
      completedAt: now,
      id: uuidv7(),
      itemCount: portfolioItems.length,
      projectId: input.projectId,
      sourceRevision: input.revision,
      status: 'completed',
      tenantId: input.tenantId,
    })
    .onConflictDoUpdate({
      set: {
        completedAt: now,
        itemCount: portfolioItems.length,
        status: 'completed',
      },
      target: [
        schema.contentCatalogSyncs.projectId,
        schema.contentCatalogSyncs.sourceRevision,
      ],
    })
    .returning({ id: schema.contentCatalogSyncs.id });
  if (catalogSync === undefined) return;

  for (const item of portfolioItems) {
    await database
      .insert(schema.contentCatalogItems)
      .values({
        category: item.category,
        contentHash: item.contentHash,
        id: uuidv7(),
        locale: item.locale,
        normalizedTitle: normalizeTitle(item.title),
        projectId: input.projectId,
        slug: item.slug,
        sourceId: item.sourceId,
        sourceRevision: item.sourceRevision,
        syncId: catalogSync.id,
        tenantId: input.tenantId,
        title: item.title,
      })
      .onConflictDoUpdate({
        set: {
          category: item.category,
          contentHash: item.contentHash,
          normalizedTitle: normalizeTitle(item.title),
          slug: item.slug,
          sourceRevision: item.sourceRevision,
          status: 'published',
          syncId: catalogSync.id,
          title: item.title,
          updatedAt: now,
        },
        target: [
          schema.contentCatalogItems.projectId,
          schema.contentCatalogItems.sourceId,
          schema.contentCatalogItems.locale,
        ],
      });
  }

  const activeKeys = new Set(
    portfolioItems.map((item) => `${item.sourceId}\0${item.locale}`),
  );
  const portfolio = input.manifest.content.portfolio;
  const portfolioDirectories =
    portfolio === undefined
      ? []
      : [
          ...new Set(
            Object.values(portfolio.collections).flatMap((collection) =>
              collection === undefined ? [] : [collection.directory],
            ),
          ),
        ];
  const publishedRows = await database
    .select({
      locale: schema.contentCatalogItems.locale,
      sourceId: schema.contentCatalogItems.sourceId,
    })
    .from(schema.contentCatalogItems)
    .where(
      and(
        eq(schema.contentCatalogItems.projectId, input.projectId),
        eq(schema.contentCatalogItems.status, 'published'),
      ),
    );
  for (const row of publishedRows) {
    if (
      !portfolioDirectories.some((directory) =>
        row.sourceId.startsWith(`${directory}/`),
      )
    )
      continue;
    if (activeKeys.has(`${row.sourceId}\0${row.locale}`)) continue;
    await database
      .update(schema.contentCatalogItems)
      .set({ status: 'deleted', updatedAt: now })
      .where(
        and(
          eq(schema.contentCatalogItems.projectId, input.projectId),
          eq(schema.contentCatalogItems.sourceId, row.sourceId),
          eq(schema.contentCatalogItems.locale, row.locale),
        ),
      );
  }
};
