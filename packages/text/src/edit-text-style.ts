import { createHash } from 'node:crypto';

import type { ProjectManifest, TextStylePatch } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type {
  DeploymentPort,
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';
import type { OrbitypePageSnapshot } from '@binflow/menu';

import {
  resolveTextEditCandidate,
  type TextEditCandidate,
} from './discover-editable-copy.js';
import {
  fallbackTextEditGithubPath,
  restoreOrbitypeTextPreview,
  type OrbitypeTextPagesPort,
  type OrbitypeTextPreviewState,
} from './edit-text.js';
import {
  applyTextStylePatch,
  buildInlineStyleAttribute,
} from './text-style.js';

export type TextStylePatchArtifact = Readonly<{
  candidate: TextEditCandidate;
  githubPath: string;
  orbitypePreview?: OrbitypeTextPreviewState;
  previewRoute: string;
  style: TextStylePatch;
  targetExcerpt: string;
}>;

export type TextStylePreviewResult = Readonly<{
  deployment: Awaited<ReturnType<DeploymentPort['waitForPreview']>>;
  patch: TextStylePatchArtifact;
  publication: DraftPublication;
}>;

export type TextStylePublishResult = Readonly<{
  mergeCommitSha: string;
  previewRoute: string;
  publication: DraftPublication;
  urls: Readonly<Record<string, string>>;
}>;

export type TextStyleGithubDraftFile = Readonly<{
  bytes: Uint8Array;
  mime: 'text/plain';
  path: string;
  sha256: string;
}>;

const CMS_MIRROR_CANDIDATE_PATHS = (slug: string): readonly string[] =>
  Object.freeze([
    `cms/collections/${slug}.json`,
    `cms/collections/pages/${slug}.json`,
    `cms/collections/page-${slug}.json`,
  ]);

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const STYLE_VERIFY_POLL_MS = 5_000;
const STYLE_VERIFY_TIMEOUT_MS = 120_000;

export const verifyProductionStyleVisible = async (
  url: string,
  excerpt: string,
  style: TextStylePatch,
  options: Readonly<{
    pollIntervalMs?: number;
    timeoutMs?: number;
  }> = {},
): Promise<void> => {
  const pollIntervalMs = options.pollIntervalMs ?? STYLE_VERIFY_POLL_MS;
  const deadline =
    Date.now() + (options.timeoutMs ?? STYLE_VERIFY_TIMEOUT_MS);
  const styleAttr = buildInlineStyleAttribute(style);
  let lastStatus: string | undefined;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 200) {
        const body = await response.text();
        const hasMarker = body.includes('data-binflow-style');
        const hasExcerpt = body.includes(excerpt);
        const hasStyle =
          styleAttr.length === 0 ||
          styleAttr.split(';').every((part) => body.includes(part));
        if (hasMarker && hasExcerpt && hasStyle) return;
        lastStatus = 'style_missing';
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
    'Production page does not show the approved text style.',
    { code: 'production_style_mismatch', status: lastStatus ?? 'unknown' },
  );
};

const assertEditableCmsPath = (
  path: string,
  editablePaths: readonly string[],
): void => {
  const allowed = editablePaths.some((pattern) =>
    pattern === 'cms/collections/**'
      ? path.startsWith('cms/collections/')
      : pattern === path,
  );
  if (!allowed)
    throw new DomainError(
      'validation_error',
      'CMS mirror path is outside manifest editablePaths.',
      { code: 'manifest_path_denied' },
    );
};

const serializePatchedPage = (
  existing: Uint8Array | null,
  page: OrbitypePageSnapshot,
  patchedSections: unknown,
): Uint8Array => {
  let document: Record<string, unknown> = {
    id: page.id,
    sections: patchedSections,
    slug: page.slug,
    title: page.title,
  };
  if (existing !== null) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(existing)) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
        document = {
          ...(parsed as Record<string, unknown>),
          sections: patchedSections,
        };
    } catch {
      throw new DomainError(
        'validation_error',
        'GitHub CMS mirror is not valid JSON.',
        { code: 'github_pr_failed' },
      );
    }
  }
  return new TextEncoder().encode(JSON.stringify(document, null, 2));
};

export const buildTextStyleGithubDraftFiles = async (input: Readonly<{
  defaultBranchRef: string;
  editablePaths: readonly string[];
  page: OrbitypePageSnapshot;
  patchedSections: unknown;
  repository: RepositoryPublicationPort;
  resolved: TextEditCandidate;
}>): Promise<Readonly<{ files: readonly TextStyleGithubDraftFile[]; path: string }>> => {
  let path: string | undefined;
  let existing: Uint8Array | null = null;
  for (const candidatePath of CMS_MIRROR_CANDIDATE_PATHS(
    input.resolved.pageSlug,
  )) {
    assertEditableCmsPath(candidatePath, input.editablePaths);
    const bytes = await input.repository.readFileAtRef({
      path: candidatePath,
      ref: input.defaultBranchRef,
    });
    if (bytes === null) continue;
    if (new TextDecoder().decode(bytes).includes(input.resolved.currentValue)) {
      path = candidatePath;
      existing = bytes;
      break;
    }
  }
  path ??= fallbackTextEditGithubPath(input.resolved.pageSlug);
  assertEditableCmsPath(path, input.editablePaths);
  existing ??= await input.repository.readFileAtRef({
    path,
    ref: input.defaultBranchRef,
  });
  const bytes = serializePatchedPage(existing, input.page, input.patchedSections);
  return {
    files: [
      {
        bytes,
        mime: 'text/plain',
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    path,
  };
};

export class EditTextStyleExecutor {
  public constructor(
    private readonly repository: RepositoryPublicationPort,
    private readonly deployments: DeploymentPort,
  ) {}

  public async preparePreview(input: Readonly<{
    candidate: TextEditCandidate;
    defaultBranchRef: string;
    manifest: ProjectManifest;
    onStage?: (node: string) => Promise<void>;
    orbitype: OrbitypeTextPagesPort;
    productionOrigin: string;
    requestId: string;
    style: TextStylePatch;
    targetExcerpt: string;
  }>): Promise<TextStylePreviewResult> {
    await input.onStage?.('sync_editable_copy');
    const pages = await input.orbitype.listPages();
    await input.onStage?.('validate_text_style');
    const resolved = resolveTextEditCandidate(
      pages,
      input.manifest.contentLocales,
      input.candidate.key,
    );
    if (resolved?.currentValue !== input.candidate.currentValue)
      throw new DomainError(
        'validation_error',
        'Text style target changed before execute.',
        {
          code:
            resolved === null ? 'text_target_not_found' : 'text_target_stale',
        },
      );

    await input.onStage?.('render_style_patch');
    const page = pages.find((entry) => entry.id === resolved.pageId);
    if (page === undefined)
      throw new DomainError(
        'validation_error',
        'Text style page disappeared during render.',
        { code: 'text_target_stale' },
      );
    const patchedSections = applyTextStylePatch(page.sections, {
      excerpt: input.targetExcerpt,
      field: resolved.field,
      locale: resolved.locale,
      sectionIndex: resolved.sectionIndex,
      style: input.style,
    });
    const githubDraft = await buildTextStyleGithubDraftFiles({
      defaultBranchRef: input.defaultBranchRef,
      editablePaths: input.manifest.content.editablePaths,
      page,
      patchedSections,
      repository: this.repository,
      resolved,
    });

    await input.onStage?.('open_style_edit_pr');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'edit-text-style')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', resolved.pageSlug);
    const publication = await this.repository.createDraft({
      branch,
      files: [...githubDraft.files],
      requestId: input.requestId,
      slug: resolved.pageSlug,
    });
    if (publication.headCommitSha.length < 7)
      throw new DomainError(
        'provider_final',
        'Text style PR could not be opened.',
        { code: 'github_pr_failed' },
      );

    const previewRoute = `/${resolved.pageSlug}`;
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

    const freshPages = await input.orbitype.listPages();
    const freshPage = freshPages.find((entry) => entry.id === resolved.pageId);
    if (freshPage === undefined)
      throw new DomainError(
        'validation_error',
        'Text style page disappeared before Orbitype preview.',
        { code: 'text_target_stale' },
      );
    const restore = { pageId: freshPage.id, sections: freshPage.sections };
    const previewSections = applyTextStylePatch(freshPage.sections, {
      excerpt: input.targetExcerpt,
      field: resolved.field,
      locale: resolved.locale,
      sectionIndex: resolved.sectionIndex,
      style: input.style,
    });
    await input.onStage?.('apply_orbitype_preview');
    try {
      await input.orbitype.applySectionPatches({
        patches: [{ pageId: resolved.pageId, sections: previewSections }],
      });
    } catch (error) {
      try {
        await restoreOrbitypeTextPreview(input.orbitype, restore);
      } catch {
        // Best-effort compensation; preserve the original provider failure.
      }
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Orbitype style preview patch failed.',
        { code: 'orbitype_pages_patch_failed' },
      );
    }

    return {
      deployment,
      patch: {
        candidate: resolved,
        githubPath: githubDraft.path,
        orbitypePreview: { applied: true, restore },
        previewRoute,
        style: input.style,
        targetExcerpt: input.targetExcerpt,
      },
      publication,
    };
  }

  public async publish(input: Readonly<{
    expectedHeadSha: string;
    manifest: ProjectManifest;
    onStage?: (node: string) => Promise<void>;
    orbitype: OrbitypeTextPagesPort;
    patch: TextStylePatchArtifact;
    productionOrigin: string;
    pullRequestId: string;
  }>): Promise<TextStylePublishResult> {
    await input.onStage?.('merge_github');
    const merged = await this.repository.merge({
      expectedHeadSha: input.expectedHeadSha,
      pullRequestId: input.pullRequestId,
    });
    await input.onStage?.('publish_orbitype_pages');
    const pages = await input.orbitype.listPages();
    const page = pages.find((entry) => entry.id === input.patch.candidate.pageId);
    if (page === undefined)
      throw new DomainError(
        'provider_final',
        'Text style page is missing after merge.',
        { code: 'orbitype_pages_patch_failed' },
      );
    const patchedSections = applyTextStylePatch(page.sections, {
      excerpt: input.patch.targetExcerpt,
      field: input.patch.candidate.field,
      locale: input.patch.candidate.locale,
      sectionIndex: input.patch.candidate.sectionIndex,
      style: input.patch.style,
    });
    try {
      await input.orbitype.applySectionPatches({
        patches: [{ pageId: page.id, sections: patchedSections }],
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Orbitype style patch failed after GitHub merge.',
        { code: 'orbitype_pages_patch_failed' },
      );
    }
    await input.onStage?.('verify_production');
    const productionUrl = `${input.productionOrigin.replace(/\/$/u, '')}${input.patch.previewRoute}`;
    await verifyProductionStyleVisible(
      productionUrl,
      input.patch.targetExcerpt,
      input.patch.style,
    );
    await input.onStage?.('completed');
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
      urls: Object.freeze({ page: productionUrl }),
    };
  }
}

export {
  applyTextStylePatch,
  assertSingleFieldKind,
  fieldKindForTextField,
  parseClientHex,
  readTextStyleBaseline,
  resolveStylePatch,
  adjustHexLightness,
  wrapExcerptWithStyle,
  buildInlineStyleAttribute,
  type TextStyleBaseline,
  type TextStyleFieldKind,
} from './text-style.js';
