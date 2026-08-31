import { createHash } from 'node:crypto';

import type { SupportedLocale } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type {
  BlogFile,
  DeploymentPort,
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';
import type { OrbitypePageSnapshot } from '@binflow/menu';

import {
  applyImageFieldPatchAllLocales,
  assertImageStillMatches,
  getSectionComponent,
  resolveImageEditCandidate,
  type ImageEditCandidate,
  type OrbitypePostSnapshot,
} from './discover-editable-images.js';

export type OrbitypeImagesPort = Readonly<{
  applyPageSectionPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{ pageId: string; sections: unknown }>
      >;
    }>,
  ): Promise<void>;
  applyPostPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{
          postId: string;
          img?: string;
          sections?: unknown;
        }>
      >;
    }>,
  ): Promise<void>;
  listPages(): Promise<readonly OrbitypePageSnapshot[]>;
  listPosts(): Promise<readonly OrbitypePostSnapshot[]>;
}>;

export type OrbitypeImageRestoreSnapshot = Readonly<{
  id: string;
  img?: string;
  kind: 'page' | 'post';
  sections: unknown;
}>;

export type OrbitypeImagePreviewState = Readonly<{
  applied: true;
  restore: OrbitypeImageRestoreSnapshot;
  restored?: boolean;
  temporaryImageUrl: string;
}>;

export type ImageEditPatchArtifact = Readonly<{
  candidate: ImageEditCandidate;
  githubPath: string;
  newPublicPath: string;
  orbitypePreview?: OrbitypeImagePreviewState;
  previewRoute: string;
}>;

export type ImageEditPreviewResult = Readonly<{
  deployment: Awaited<ReturnType<DeploymentPort['waitForPreview']>>;
  patch: ImageEditPatchArtifact;
  publication: DraftPublication;
}>;

export type ImageEditPublishResult = Readonly<{
  mergeCommitSha: string;
  previewRoute: string;
  publication: DraftPublication;
  urls: Readonly<Record<string, string>>;
}>;

const CMS_MIRROR_PAGE_PATHS = (slug: string): readonly string[] =>
  Object.freeze([
    `cms/collections/${slug}.json`,
    `cms/collections/pages/${slug}.json`,
    `cms/collections/page-${slug}.json`,
  ]);

const CMS_MIRROR_POST_PATHS = (postId: string): readonly string[] =>
  Object.freeze([
    `cms/collections/posts/${postId}.json`,
    `cms/collections/${postId}.json`,
  ]);

export const fallbackImageEditGithubPath = (
  kind: 'page' | 'blog',
  slugOrId: string,
): string =>
  kind === 'page'
    ? `cms/collections/pages/${slugOrId}.json`
    : `cms/collections/posts/${slugOrId}.json`;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const IMAGE_VERIFY_POLL_MS = 5_000;
const IMAGE_VERIFY_TIMEOUT_MS = 120_000;

const mimeToExtension = (mime: string): string => {
  switch (mime) {
    case 'image/avif':
      return 'avif';
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    default:
      return 'avif';
  }
};

export const buildNewPublicImagePath = (
  requestId: string,
  mime: string,
  imageDirectory = 'public/images/blog',
): string => {
  const requestIdShort = requestId.replaceAll(/-/gu, '').slice(0, 8) || 'edit';
  const relative = imageDirectory
    .replace(/^public\/?/u, '')
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '');
  const publicPrefix = relative.length > 0 ? `/${relative}` : '/images/blog';
  return `${publicPrefix}/edit-${requestIdShort}.${mimeToExtension(mime)}`;
};

export const verifyProductionImageVisible = async (
  pageUrl: string,
  newPublicPath: string,
  options: Readonly<{
    pollIntervalMs?: number;
    timeoutMs?: number;
  }> = {},
): Promise<void> => {
  const pollIntervalMs = options.pollIntervalMs ?? IMAGE_VERIFY_POLL_MS;
  const deadline =
    Date.now() + (options.timeoutMs ?? IMAGE_VERIFY_TIMEOUT_MS);
  let lastStatus: string | undefined;
  const origin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch {
      return null;
    }
  })();
  const imageUrl =
    origin === null
      ? null
      : `${origin}${newPublicPath.startsWith('/') ? newPublicPath : `/${newPublicPath}`}`;

  while (Date.now() <= deadline) {
    try {
      if (imageUrl !== null) {
        const imageResponse = await fetch(imageUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        });
        if (imageResponse.status === 200) return;
        lastStatus = `image_${String(imageResponse.status)}`;
      }
      const response = await fetch(pageUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 200) {
        const body = await response.text();
        if (body.includes(newPublicPath)) return;
        lastStatus = 'path_missing';
      } else {
        lastStatus = String(response.status);
      }
    } catch {
      lastStatus = 'unreachable';
    }
    if (Date.now() + pollIntervalMs > deadline) break;
    await sleep(pollIntervalMs);
  }
  throw new DomainError(
    'provider_final',
    'Production does not serve the approved new image.',
    { code: 'production_image_mismatch', status: lastStatus ?? 'unknown' },
  );
};

const assertEditableCmsPath = (
  path: string,
  editablePaths: readonly string[],
): void => {
  const allowed = editablePaths.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -2);
      return path.startsWith(prefix);
    }
    if (pattern.includes('*')) {
      const escaped = pattern
        .replaceAll(/[.+^${}()|[\]\\]/gu, '\\$&')
        .replaceAll('**', '::DOUBLE::')
        .replaceAll('*', '[^/]*')
        .replaceAll('::DOUBLE::', '.*');
      return new RegExp(`^${escaped}$`, 'u').test(path);
    }
    return pattern === path;
  });
  if (!allowed)
    throw new DomainError(
      'validation_error',
      'Path is outside manifest editablePaths.',
      { code: 'manifest_path_denied' },
    );
};

const resolveGithubMirrorPath = async (
  repository: RepositoryPublicationPort,
  ref: string,
  candidatePaths: readonly string[],
  oldPath: string,
  editablePaths: readonly string[],
): Promise<string | undefined> => {
  for (const path of candidatePaths) {
    assertEditableCmsPath(path, editablePaths);
    const bytes = await repository.readFileAtRef({ path, ref });
    if (bytes === null) continue;
    const text = new TextDecoder().decode(bytes);
    if (text.includes(oldPath)) return path;
  }
  return undefined;
};

const patchGithubMirrorFile = (
  content: string,
  oldPath: string,
  newPath: string,
): string => {
  if (!content.includes(oldPath))
    throw new DomainError(
      'validation_error',
      'GitHub mirror no longer contains the target image path.',
      { code: 'image_target_stale' },
    );
  return content.replaceAll(oldPath, newPath);
};

export type ImageEditGithubDraftFile = Readonly<{
  bytes: Uint8Array;
  mime: BlogFile['mime'];
  path: string;
  sha256: string;
}>;

const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Build the GitHub draft file set for an image edit. Always returns ≥1 file so
 * createDraft never receives an empty files array.
 */
export const buildImageEditGithubDraftFiles = async (input: Readonly<{
  defaultBranchRef: string;
  editablePaths: readonly string[];
  imageBytes: Uint8Array;
  mime: string;
  newPublicPath: string;
  pageOrPost: Readonly<{ id: string; sections: unknown; title: unknown }> &
    Readonly<{ slug?: string } | { img?: string }>;
  patchedPayload: Readonly<{ img?: string; sections?: unknown }>;
  repository: RepositoryPublicationPort;
  resolved: ImageEditCandidate;
}>): Promise<
  Readonly<{ files: readonly ImageEditGithubDraftFile[]; path: string }>
> => {
  const files: ImageEditGithubDraftFile[] = [];
  let primaryPath = '';

  if (input.newPublicPath.startsWith('/images/')) {
    const publicRepoPath = `public${input.newPublicPath}`;
    assertEditableCmsPath(publicRepoPath, input.editablePaths);
    files.push({
      bytes: input.imageBytes,
      // BlogFile currently allowlists image/avif for binary image drafts.
      mime: 'image/avif',
      path: publicRepoPath,
      sha256: sha256Hex(input.imageBytes),
    });
    primaryPath = publicRepoPath;
  }

  const mirrorCandidates =
    input.resolved.kind === 'page'
      ? CMS_MIRROR_PAGE_PATHS(input.resolved.pageOrPostSlug)
      : CMS_MIRROR_POST_PATHS(input.resolved.pageOrPostId);

  const githubPath = await resolveGithubMirrorPath(
    input.repository,
    input.defaultBranchRef,
    mirrorCandidates,
    input.resolved.currentPath,
    input.editablePaths,
  );

  if (githubPath !== undefined) {
    const existing = await input.repository.readFileAtRef({
      path: githubPath,
      ref: input.defaultBranchRef,
    });
    if (existing === null)
      throw new DomainError(
        'validation_error',
        'GitHub CMS mirror file is missing.',
        { code: 'github_pr_failed' },
      );
    const updated = patchGithubMirrorFile(
      new TextDecoder().decode(existing),
      input.resolved.currentPath,
      input.newPublicPath,
    );
    const bytes = new TextEncoder().encode(updated);
    files.push({
      bytes,
      mime: 'text/plain',
      path: githubPath,
      sha256: sha256Hex(bytes),
    });
    if (primaryPath.length === 0) primaryPath = githubPath;
  } else if (files.length === 0) {
    const fallbackPath = fallbackImageEditGithubPath(
      input.resolved.kind,
      input.resolved.kind === 'page'
        ? input.resolved.pageOrPostSlug
        : input.resolved.pageOrPostId,
    );
    assertEditableCmsPath(fallbackPath, input.editablePaths);
    const existingFallback = await input.repository.readFileAtRef({
      path: fallbackPath,
      ref: input.defaultBranchRef,
    });
    let payload: string;
    if (existingFallback !== null) {
      const current = new TextDecoder().decode(existingFallback);
      payload = current.includes(input.resolved.currentPath)
        ? patchGithubMirrorFile(
            current,
            input.resolved.currentPath,
            input.newPublicPath,
          )
        : JSON.stringify(
            {
              id: input.pageOrPost.id,
              ...(input.resolved.kind === 'page'
                ? { slug: input.resolved.pageOrPostSlug }
                : {}),
              ...input.patchedPayload,
              title: input.pageOrPost.title,
            },
            null,
            2,
          );
    } else {
      payload = JSON.stringify(
        {
          id: input.pageOrPost.id,
          ...(input.resolved.kind === 'page'
            ? { slug: input.resolved.pageOrPostSlug }
            : {}),
          ...input.patchedPayload,
          title: input.pageOrPost.title,
        },
        null,
        2,
      );
    }
    const bytes = new TextEncoder().encode(payload);
    files.push({
      bytes,
      mime: 'text/plain',
      path: fallbackPath,
      sha256: sha256Hex(bytes),
    });
    primaryPath = fallbackPath;
  }

  if (files.length === 0)
    throw new DomainError(
      'validation_error',
      'Image edit draft produced no files.',
      { code: 'github_pr_failed' },
    );

  return { files, path: primaryPath };
};

const previewRouteFor = (candidate: ImageEditCandidate): string =>
  candidate.kind === 'page'
    ? `/${candidate.pageOrPostSlug}`
    : `/${candidate.pageOrPostId}`;

const patchPageSections = (
  sections: unknown,
  candidate: ImageEditCandidate,
  newPath: string,
  locales: readonly SupportedLocale[],
): unknown =>
  applyImageFieldPatchAllLocales(sections, {
    field: candidate.field,
    locales,
    newPath,
    sectionIndex: candidate.sectionIndex,
  });

const patchBlogCoverAndHero = (
  post: OrbitypePostSnapshot,
  newPath: string,
  locales: readonly SupportedLocale[],
): Readonly<{ img: string; sections: unknown }> => {
  let sections = post.sections;
  if (Array.isArray(sections) && sections.length > 0) {
    const first = sections[0];
    if (
      first !== null &&
      typeof first === 'object' &&
      !Array.isArray(first) &&
      getSectionComponent(first as Record<string, unknown>) === 'SectionPostHero'
    ) {
      sections = applyImageFieldPatchAllLocales(sections, {
        field: 'img',
        locales,
        newPath,
        sectionIndex: 0,
      });
    }
  }
  return { img: newPath, sections };
};

export const previewOriginFromDeployment = (
  deployment: Awaited<ReturnType<DeploymentPort['waitForPreview']>>,
  previewRoute: string,
): string => {
  const routeUrl = deployment.urls[previewRoute];
  const candidate =
    typeof routeUrl === 'string' && routeUrl.trim().length > 0
      ? routeUrl
      : Object.values(deployment.urls).find(
          (value) => typeof value === 'string' && value.trim().length > 0,
        );
  if (typeof candidate !== 'string')
    throw new DomainError(
      'provider_final',
      'Vercel preview URL is missing.',
      { code: 'preview_not_ready' },
    );
  try {
    return new URL(candidate).origin;
  } catch {
    throw new DomainError(
      'provider_final',
      'Vercel preview URL is invalid.',
      { code: 'preview_not_ready' },
    );
  }
};

export const snapshotOrbitypeImageRestore = (
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  candidate: ImageEditCandidate,
): OrbitypeImageRestoreSnapshot => {
  if (candidate.kind === 'page') {
    const page = pages.find((entry) => entry.id === candidate.pageOrPostId);
    if (page === undefined)
      throw new DomainError(
        'validation_error',
        'Image edit page disappeared during snapshot.',
        { code: 'image_target_stale' },
      );
    return {
      id: page.id,
      kind: 'page',
      sections: page.sections,
    };
  }
  const post = posts.find((entry) => entry.id === candidate.pageOrPostId);
  if (post === undefined)
    throw new DomainError(
      'validation_error',
      'Image edit post disappeared during snapshot.',
      { code: 'image_target_stale' },
    );
  return {
    id: post.id,
    ...(typeof post.img === 'string' ? { img: post.img } : {}),
    kind: 'post',
    sections: post.sections,
  };
};

export const restoreOrbitypeImagePreview = async (
  orbitype: OrbitypeImagesPort,
  restore: OrbitypeImageRestoreSnapshot,
): Promise<void> => {
  if (restore.kind === 'page') {
    await orbitype.applyPageSectionPatches({
      patches: [{ pageId: restore.id, sections: restore.sections }],
    });
    return;
  }
  await orbitype.applyPostPatches({
    patches: [
      {
        postId: restore.id,
        sections: restore.sections,
        ...(restore.img === undefined ? {} : { img: restore.img }),
      },
    ],
  });
};

const applyOrbitypeImagePatch = async (
  orbitype: OrbitypeImagesPort,
  pages: readonly OrbitypePageSnapshot[],
  posts: readonly OrbitypePostSnapshot[],
  candidate: ImageEditCandidate,
  newPublicPath: string,
  locales: readonly SupportedLocale[],
): Promise<void> => {
  if (candidate.kind === 'page') {
    const page = pages.find((entry) => entry.id === candidate.pageOrPostId);
    if (page === undefined)
      throw new DomainError(
        'validation_error',
        'Image edit page disappeared during patch.',
        { code: 'image_target_stale' },
      );
    const patchedSections = patchPageSections(
      page.sections,
      candidate,
      newPublicPath,
      locales,
    );
    await orbitype.applyPageSectionPatches({
      patches: [{ pageId: candidate.pageOrPostId, sections: patchedSections }],
    });
    return;
  }

  const post = posts.find((entry) => entry.id === candidate.pageOrPostId);
  if (post === undefined)
    throw new DomainError(
      'validation_error',
      'Image edit post disappeared during patch.',
      { code: 'image_target_stale' },
    );

  if (candidate.sectionIndex < 0) {
    const patched = patchBlogCoverAndHero(post, newPublicPath, locales);
    await orbitype.applyPostPatches({
      patches: [
        {
          postId: candidate.pageOrPostId,
          img: patched.img,
          sections: patched.sections,
        },
      ],
    });
    return;
  }

  const patchedSections = applyImageFieldPatchAllLocales(post.sections, {
    field: candidate.field,
    locales,
    newPath: newPublicPath,
    sectionIndex: candidate.sectionIndex,
  });
  const syncCover =
    candidate.field === 'img' &&
    candidate.component === 'SectionPostHero' &&
    candidate.sectionIndex === 0;
  if (syncCover) {
    await orbitype.applyPostPatches({
      patches: [
        {
          postId: candidate.pageOrPostId,
          img: newPublicPath,
          sections: patchedSections,
        },
      ],
    });
    return;
  }
  await orbitype.applyPostPatches({
    patches: [{ postId: candidate.pageOrPostId, sections: patchedSections }],
  });
};

export class EditImageExecutor {
  public constructor(
    private readonly repository: RepositoryPublicationPort,
    private readonly deployments: DeploymentPort,
  ) {}

  public async preparePreview(
    input: Readonly<{
      candidate: ImageEditCandidate;
      defaultBranchRef: string;
      imageBytes: Uint8Array;
      manifest: import('@binflow/contracts').ProjectManifest;
      mime: string;
      newPublicPath?: string;
      onStage?: (node: string) => Promise<void>;
      orbitype: OrbitypeImagesPort;
      productionOrigin: string;
      requestId: string;
    }>,
  ): Promise<ImageEditPreviewResult> {
    await input.onStage?.('sync_editable_images');
    const pages = await input.orbitype.listPages();
    const posts = await input.orbitype.listPosts();
    await input.onStage?.('validate_image_edit');
    const resolved = resolveImageEditCandidate(
      pages,
      posts,
      input.manifest.contentLocales,
      input.candidate.key,
    );
    if (resolved === null)
      throw new DomainError(
        'validation_error',
        'Image edit target is no longer available.',
        { code: 'image_target_not_found' },
      );
    try {
      assertImageStillMatches(
        pages,
        posts,
        input.candidate,
        input.manifest.contentLocales,
      );
    } catch {
      throw new DomainError(
        'validation_error',
        'Image edit target changed before execute.',
        { code: 'image_target_stale' },
      );
    }
    if (input.imageBytes.byteLength === 0)
      throw new DomainError(
        'validation_error',
        'Replacement image cannot be empty.',
        { code: 'image_replacement_missing' },
      );

    const newPublicPath =
      input.newPublicPath ??
      buildNewPublicImagePath(
        input.requestId,
        input.mime,
        input.manifest.content.imageDirectory ?? 'public/images/blog',
      );

    await input.onStage?.('render_image_patch');
    let patchedPayload: Readonly<{ img?: string; sections?: unknown }>;
    let pageOrPost:
      | OrbitypePageSnapshot
      | OrbitypePostSnapshot;

    if (resolved.kind === 'page') {
      const page = pages.find((entry) => entry.id === resolved.pageOrPostId);
      if (page === undefined)
        throw new DomainError(
          'validation_error',
          'Image edit page disappeared during render.',
          { code: 'image_target_stale' },
        );
      pageOrPost = page;
      patchedPayload = {
        sections: patchPageSections(
          page.sections,
          resolved,
          newPublicPath,
          input.manifest.contentLocales,
        ),
      };
    } else {
      const post = posts.find((entry) => entry.id === resolved.pageOrPostId);
      if (post === undefined)
        throw new DomainError(
          'validation_error',
          'Image edit post disappeared during render.',
          { code: 'image_target_stale' },
        );
      pageOrPost = post;
      if (resolved.sectionIndex < 0) {
        patchedPayload = patchBlogCoverAndHero(
          post,
          newPublicPath,
          input.manifest.contentLocales,
        );
      } else {
        const sections = applyImageFieldPatchAllLocales(post.sections, {
          field: resolved.field,
          locales: input.manifest.contentLocales,
          newPath: newPublicPath,
          sectionIndex: resolved.sectionIndex,
        });
        const syncCover =
          resolved.field === 'img' &&
          resolved.component === 'SectionPostHero' &&
          resolved.sectionIndex === 0;
        patchedPayload = syncCover
          ? { img: newPublicPath, sections }
          : { sections };
      }
    }

    const githubDraft = await buildImageEditGithubDraftFiles({
      defaultBranchRef: input.defaultBranchRef,
      editablePaths: input.manifest.content.editablePaths,
      imageBytes: input.imageBytes,
      mime: input.mime,
      newPublicPath,
      pageOrPost,
      patchedPayload,
      repository: this.repository,
      resolved,
    });

    await input.onStage?.('open_image_edit_pr');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'edit-image')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', resolved.pageOrPostSlug);
    const publication = await this.repository.createDraft({
      branch,
      files: [...githubDraft.files],
      requestId: input.requestId,
      slug: resolved.pageOrPostSlug,
    });
    if (publication.headCommitSha.length < 7)
      throw new DomainError(
        'provider_final',
        'Image edit PR could not be opened.',
        { code: 'github_pr_failed' },
      );

    const previewRoute = previewRouteFor(resolved);
    await input.onStage?.('wait_preview');
    let deployment: Awaited<ReturnType<DeploymentPort['waitForPreview']>>;
    try {
      deployment = await this.deployments.waitForPreview({
        headCommitSha: publication.headCommitSha,
        routes: [previewRoute],
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Vercel preview did not become ready.',
        { code: 'preview_not_ready' },
      );
    }

    // Temporary live CMS patch so runtime-Orbitype sites show the change.
    // Use absolute preview asset URL so production does not 404 on PR-only paths.
    const freshPages = await input.orbitype.listPages();
    const freshPosts = await input.orbitype.listPosts();
    const restore = snapshotOrbitypeImageRestore(
      freshPages,
      freshPosts,
      resolved,
    );
    const temporaryImageUrl = `${previewOriginFromDeployment(deployment, previewRoute)}${newPublicPath}`;
    await input.onStage?.('apply_orbitype_preview');
    try {
      await applyOrbitypeImagePatch(
        input.orbitype,
        freshPages,
        freshPosts,
        resolved,
        temporaryImageUrl,
        input.manifest.contentLocales,
      );
    } catch (error) {
      try {
        await restoreOrbitypeImagePreview(input.orbitype, restore);
      } catch {
        // Best-effort compensating restore; surface the original apply error.
      }
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Orbitype preview content patch failed.',
        { code: 'orbitype_content_patch_failed' },
      );
    }

    return {
      deployment,
      patch: {
        candidate: resolved,
        githubPath: githubDraft.path,
        newPublicPath,
        orbitypePreview: {
          applied: true,
          restore,
          temporaryImageUrl,
        },
        previewRoute,
      },
      publication,
    };
  }

  public async publish(
    input: Readonly<{
      expectedHeadSha: string;
      manifest: import('@binflow/contracts').ProjectManifest;
      onStage?: (node: string) => Promise<void>;
      orbitype: OrbitypeImagesPort;
      patch: ImageEditPatchArtifact;
      productionOrigin: string;
      pullRequestId: string;
    }>,
  ): Promise<ImageEditPublishResult> {
    await input.onStage?.('merge_github');
    const merged = await this.repository.merge({
      expectedHeadSha: input.expectedHeadSha,
      pullRequestId: input.pullRequestId,
    });

    await input.onStage?.('publish_orbitype_content');
    const pages = await input.orbitype.listPages();
    const posts = await input.orbitype.listPosts();
    try {
      await applyOrbitypeImagePatch(
        input.orbitype,
        pages,
        posts,
        input.patch.candidate,
        input.patch.newPublicPath,
        input.manifest.contentLocales,
      );
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Orbitype content patch failed after GitHub merge.',
        { code: 'orbitype_content_patch_failed' },
      );
    }

    await input.onStage?.('verify_production');
    const productionUrl = `${input.productionOrigin.replace(/\/$/u, '')}${input.patch.previewRoute}`;
    await verifyProductionImageVisible(
      productionUrl,
      input.patch.newPublicPath,
    );
    await input.onStage?.('completed');

    const urls = Object.freeze({
      image: `${input.productionOrigin.replace(/\/$/u, '')}${input.patch.newPublicPath}`,
      page: productionUrl,
    });
    return {
      mergeCommitSha: merged.mergeCommitSha,
      previewRoute: input.patch.previewRoute,
      publication: {
        baseCommitSha: input.expectedHeadSha,
        branch: '',
        files: [input.patch.githubPath],
        headCommitSha: merged.mergeCommitSha,
        pullRequestId: input.pullRequestId,
        pullRequestUrl: '',
      },
      urls,
    };
  }
}

export {
  applyImageFieldPatch,
  applyImageFieldPatchAllLocales,
  assertImageStillMatches,
  buildImageEditKey,
  discoverEditableImages,
  resolveImageEditCandidate,
  searchEditableImages,
  type ImageEditCandidate,
  type ImageEditKind,
  type OrbitypePostSnapshot,
} from './discover-editable-images.js';
