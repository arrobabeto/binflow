import { createHash } from 'node:crypto';

import type { ProjectManifest } from '@binflow/contracts';
import type {
  BlogFile,
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';
import { DomainError } from '@binflow/domain';

import type { ImageEditCandidate } from './edit-image.js';
import {
  DEFAULT_SURFACE_INVENTORY_PATH,
  parseSurfaceInventoryImages,
  resolveInventoryImageCandidate,
  searchInventoryImages,
  type SurfaceInventoryImageRow,
} from './surface-inventory.js';

export type ThemeImageReadPort = Readonly<{
  readFile(path: string): Promise<string | null>;
}>;

export type ThemeImagePatchArtifact = Readonly<{
  candidate: ImageEditCandidate;
  githubPath: string;
  previewRoute: string;
  themePreviewUrl: string;
}>;

export type ThemeImagePreviewResult = Readonly<{
  patch: ThemeImagePatchArtifact;
  publication: DraftPublication;
  themePreviewUrl: string;
}>;

export type ThemeImagePublishResult = Readonly<{
  mergeCommitSha: string;
  previewRoute: string;
  publication: DraftPublication;
  urls: Readonly<Record<string, string>>;
}>;

const extensionForMime = (mime: string): string => {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
};

const digest = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 12);

/** True when inventory sample is a theme asset path Liquid can keep resolving. */
export const isThemeAssetPath = (path: string): boolean => {
  const normalized = path.replace(/^\//, '').trim();
  return (
    normalized.startsWith('assets/') &&
    normalized.length > 'assets/'.length &&
    !normalized.includes('..')
  );
};

/**
 * Prefer overwriting the inventory sample under `assets/**` so Liquid
 * `asset_url` keeps working. Stamp a sibling only when sample is missing
 * or not an asset path.
 */
export const resolveThemeImagePublishPath = (input: Readonly<{
  candidateKey: string;
  currentPath: string;
  replacementBytes: Uint8Array;
  replacementMime: string;
}>): string => {
  const githubPath = input.currentPath.replace(/^\//, '').trim();
  if (isThemeAssetPath(githubPath)) return githubPath;
  const extension = extensionForMime(input.replacementMime);
  if (githubPath.includes('.'))
    return githubPath.replace(
      /\.[a-z0-9]+$/iu,
      `-${digest(input.replacementBytes)}.${extension}`,
    );
  return `assets/${input.candidateKey.replaceAll('.', '-')}-${digest(input.replacementBytes)}.${extension}`;
};

export class EditThemeImageExecutor {
  public constructor(
    private readonly repository: RepositoryPublicationPort,
    private readonly reader: ThemeImageReadPort,
  ) {}

  public async loadInventory(
    inventoryPath: string = DEFAULT_SURFACE_INVENTORY_PATH,
  ): Promise<readonly SurfaceInventoryImageRow[]> {
    const raw = await this.reader.readFile(inventoryPath);
    if (raw === null || raw.trim().length === 0)
      throw new DomainError(
        'validation_error',
        'Surface inventory is missing; image allowlist is empty.',
        { code: 'surface_inventory_missing' },
      );
    const rows = parseSurfaceInventoryImages(raw);
    if (rows.length === 0)
      throw new DomainError(
        'validation_error',
        'Surface inventory has no github_theme image rows.',
        { code: 'surface_inventory_empty' },
      );
    return rows;
  }

  public search(
    rows: readonly SurfaceInventoryImageRow[],
    query: string,
  ): readonly ImageEditCandidate[] {
    return searchInventoryImages(rows, query);
  }

  public resolve(
    rows: readonly SurfaceInventoryImageRow[],
    key: string,
  ): ImageEditCandidate {
    return resolveInventoryImageCandidate(rows, key);
  }

  public async preparePreview(input: Readonly<{
    candidate: ImageEditCandidate;
    manifest: ProjectManifest;
    onStage?: (node: string) => Promise<void> | void;
    productionOrigin: string;
    replacementBytes: Uint8Array;
    replacementMime: string;
    requestId: string;
  }>): Promise<ThemeImagePreviewResult> {
    await input.onStage?.('sync_inventory_images');
    await input.onStage?.('validate_image_edit');
    if (input.replacementBytes.byteLength === 0)
      throw new DomainError(
        'validation_error',
        'Replacement image cannot be empty.',
        { code: 'image_replacement_missing' },
      );

    const publishPath = resolveThemeImagePublishPath({
      candidateKey: input.candidate.key,
      currentPath: input.candidate.currentPath,
      replacementBytes: input.replacementBytes,
      replacementMime: input.replacementMime,
    });

    await input.onStage?.('render_theme_image_patch');
    const sha256 = createHash('sha256')
      .update(input.replacementBytes)
      .digest('hex');
    const files: BlogFile[] = [
      {
        bytes: input.replacementBytes,
        // BlogFile allowlists image/avif for binary image drafts.
        mime: 'image/avif',
        path: publishPath,
        sha256,
      },
    ];

    await input.onStage?.('open_image_edit_pr');
    const branch = input.manifest.repository.branchPattern
      .replaceAll('{capability}', 'edit-image-shopify')
      .replaceAll('{projectKey}', input.manifest.repository.name)
      .replaceAll('{request-id}', input.requestId)
      .replaceAll('{slug}', input.candidate.key.replaceAll('.', '-'));
    const publication = await this.repository.createDraft({
      branch,
      files,
      requestId: input.requestId,
      slug: input.candidate.key.replaceAll('.', '-'),
    });
    if (publication.headCommitSha.length < 7)
      throw new DomainError(
        'provider_final',
        'Theme image PR could not be opened.',
        { code: 'github_pr_failed' },
      );

    const themePreviewUrl = `${input.productionOrigin.replace(/\/$/, '')}/?binflow_preview=${encodeURIComponent(publication.pullRequestId)}`;
    await input.onStage?.('record_theme_preview');

    return {
      patch: {
        candidate: {
          ...input.candidate,
          currentPath: publishPath,
        },
        githubPath: publishPath,
        previewRoute: '/',
        themePreviewUrl,
      },
      publication,
      themePreviewUrl,
    };
  }

  public async publish(input: Readonly<{
    onStage?: (node: string) => Promise<void> | void;
    productionOrigin: string;
    publication: DraftPublication;
  }>): Promise<ThemeImagePublishResult> {
    await input.onStage?.('merge_github');
    await this.repository.revalidate({
      expectedFiles: [...input.publication.files],
      expectedHeadSha: input.publication.headCommitSha,
      pullRequestId: input.publication.pullRequestId,
      requireCommitStatus: false,
    });
    const merge = await this.repository.merge({
      expectedHeadSha: input.publication.headCommitSha,
      pullRequestId: input.publication.pullRequestId,
    });
    await input.onStage?.('verify_production');
    return {
      mergeCommitSha: merge.mergeCommitSha,
      previewRoute: '/',
      publication: input.publication,
      urls: {
        production: input.productionOrigin,
        pullRequest: input.publication.pullRequestUrl,
      },
    };
  }
}
