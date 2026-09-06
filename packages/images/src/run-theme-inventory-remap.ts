import { createHash } from 'node:crypto';

import type {
  BlogFile,
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';
import { DomainError } from '@binflow/domain';

import {
  DEFAULT_SURFACE_INVENTORY_PATH,
  parseSurfaceInventoryImages,
  type SurfaceInventoryImageRow,
} from './surface-inventory.js';
import {
  remapSurfaceInventoryFromSources,
  type RemapSurfaceInventoryResult,
} from './remap-surface-inventory.js';

export type ThemeInventoryTreePort = Readonly<{
  listBlobPaths(input: Readonly<{
    prefixes: readonly string[];
    ref: string;
  }>): Promise<readonly string[]>;
  readFile(path: string, ref: string): Promise<string | null>;
}>;

export type RunThemeInventoryRemapInput = Readonly<{
  autoMerge: boolean;
  inventoryPath?: string;
  locales?: readonly string[];
  productionBranch: string;
  projectKey?: string;
  refPrefixes?: readonly string[];
  repository: RepositoryPublicationPort;
  requestId: string;
  tree: ThemeInventoryTreePort;
}>;

export type RunThemeInventoryRemapResult = Readonly<{
  imageRows: readonly SurfaceInventoryImageRow[];
  publication?: DraftPublication;
  remap: RemapSurfaceInventoryResult;
}>;

const DEFAULT_PREFIXES = ['sections/', 'snippets/', 'templates/'] as const;

const digest = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Scan theme Liquid for data-bf markers, merge inventory YAML, optionally
 * open + merge an inventory-only PR (deep search / push sync).
 */
export const runThemeInventoryRemap = async (
  input: RunThemeInventoryRemapInput,
): Promise<RunThemeInventoryRemapResult> => {
  const inventoryPath =
    input.inventoryPath?.trim() || DEFAULT_SURFACE_INVENTORY_PATH;
  const prefixes = input.refPrefixes ?? DEFAULT_PREFIXES;
  const existingRaw =
    (await input.tree.readFile(inventoryPath, input.productionBranch)) ?? '';
  const paths = await input.tree.listBlobPaths({
    prefixes: [...prefixes],
    ref: input.productionBranch,
  });
  const liquidPaths = paths.filter(
    (path) => path.endsWith('.liquid') || path.endsWith('.html'),
  );
  const sources: { path: string; source: string }[] = [];
  for (const path of liquidPaths) {
    const source = await input.tree.readFile(path, input.productionBranch);
    if (source === null || source.trim().length === 0) continue;
    sources.push({ path, source });
  }
  const remap = remapSurfaceInventoryFromSources({
    existingYaml: existingRaw,
    sources,
    ...(input.locales === undefined ? {} : { locales: input.locales }),
    ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey }),
  });
  // Always parse image rows from the remapped YAML (even when unchanged).
  const imageRows = parseSurfaceInventoryImages(remap.yaml);

  if (!remap.changed) {
    return { imageRows, remap: { ...remap, inventoryPath } };
  }

  const bytes = new TextEncoder().encode(remap.yaml);
  const files: BlogFile[] = [
    {
      bytes,
      mime: 'text/plain',
      path: inventoryPath,
      sha256: digest(bytes),
    },
  ];
  const branch = `binflow/inventory-sync-${input.requestId.slice(0, 8)}`;
  const publication = await input.repository.createDraft({
    branch,
    files,
    requestId: input.requestId,
    slug: `inventory-sync-${input.requestId.slice(0, 8)}`,
  });
  if (input.autoMerge) {
    await input.repository.revalidate({
      expectedFiles: [...publication.files],
      expectedHeadSha: publication.headCommitSha,
      pullRequestId: publication.pullRequestId,
      requireCommitStatus: false,
    });
    await input.repository.merge({
      expectedHeadSha: publication.headCommitSha,
      pullRequestId: publication.pullRequestId,
    });
  }
  // After auto-merge, re-read production; otherwise search uses remapped YAML
  // in-memory via imageRows while PR awaits merge.
  if (input.autoMerge) {
    const fresh =
      (await input.tree.readFile(inventoryPath, input.productionBranch)) ??
      remap.yaml;
    return {
      imageRows: parseSurfaceInventoryImages(fresh),
      publication,
      remap: { ...remap, inventoryPath, yaml: fresh },
    };
  }
  return {
    imageRows,
    publication,
    remap: { ...remap, inventoryPath },
  };
};

export const assertRemapSucceeded = (
  result: RunThemeInventoryRemapResult,
): void => {
  if (result.remap.changed && result.publication === undefined)
    throw new DomainError(
      'provider_final',
      'Inventory remap produced a diff but no pull request.',
      { code: 'inventory_remap_failed' },
    );
};
