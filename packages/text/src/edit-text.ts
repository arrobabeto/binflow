import { createHash } from 'node:crypto';

import type { EditTextInput, SupportedLocale } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';
import type {
  DeploymentPort,
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';
import type { OrbitypePageSnapshot } from '@binflow/menu';

import {
  applyTextFieldPatch,
  assertTextFieldStillMatches,
  resolveTextEditCandidate,
  type TextEditCandidate,
} from './discover-editable-copy.js';

export type OrbitypeTextPagesPort = Readonly<{
  applySectionPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{ pageId: string; sections: unknown }>
      >;
    }>,
  ): Promise<void>;
  listPages(): Promise<readonly OrbitypePageSnapshot[]>;
}>;

export type TextEditPatchArtifact = Readonly<{
  candidate: TextEditCandidate;
  githubPath?: string;
  newValue: string;
  previewRoute: string;
}>;

export type TextEditPreviewResult = Readonly<{
  deployment: Awaited<ReturnType<DeploymentPort['waitForPreview']>>;
  patch: TextEditPatchArtifact;
  publication: DraftPublication;
}>;

export type TextEditPublishResult = Readonly<{
  mergeCommitSha: string;
  previewRoute: string;
  publication: DraftPublication;
  urls: Readonly<Record<string, string>>;
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

const TEXT_VERIFY_POLL_MS = 5_000;
const TEXT_VERIFY_TIMEOUT_MS = 120_000;

export const verifyProductionTextVisible = async (
  url: string,
  expectedText: string,
  options: Readonly<{
    pollIntervalMs?: number;
    timeoutMs?: number;
  }> = {},
): Promise<void> => {
  const pollIntervalMs = options.pollIntervalMs ?? TEXT_VERIFY_POLL_MS;
  const deadline =
    Date.now() + (options.timeoutMs ?? TEXT_VERIFY_TIMEOUT_MS);
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
        if (body.includes(expectedText)) return;
        lastStatus = 'text_missing';
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
    'Production page does not show the approved new text.',
    { code: 'production_text_mismatch', status: lastStatus ?? 'unknown' },
  );
};

const assertEditableCmsPath = (
  path: string,
  editablePaths: readonly string[],
): void => {
  const allowed = editablePaths.some((pattern) => {
    if (pattern === 'cms/collections/**')
      return path.startsWith('cms/collections/');
    return pattern === path;
  });
  if (!allowed)
    throw new DomainError(
      'validation_error',
      'CMS mirror path is outside manifest editablePaths.',
      { code: 'manifest_path_denied' },
    );
};

const resolveGithubMirrorPath = async (
  repository: RepositoryPublicationPort,
  ref: string,
  slug: string,
  oldValue: string,
  editablePaths: readonly string[],
): Promise<string | undefined> => {
  for (const path of CMS_MIRROR_CANDIDATE_PATHS(slug)) {
    assertEditableCmsPath(path, editablePaths);
    const bytes = await repository.readFileAtRef({ path, ref });
    if (bytes === null) continue;
    const text = new TextDecoder().decode(bytes);
    if (text.includes(oldValue)) return path;
  }
  return undefined;
};

const patchGithubMirrorFile = (
  content: string,
  oldValue: string,
  newValue: string,
): string => {
  if (!content.includes(oldValue))
    throw new DomainError(
      'validation_error',
      'GitHub mirror no longer contains the target text.',
      { code: 'text_target_stale' },
    );
  return content.replace(oldValue, newValue);
};

export class EditTextExecutor {
  public constructor(
    private readonly repository: RepositoryPublicationPort,
    private readonly deployments: DeploymentPort,
  ) {}

  public async preparePreview(
    input: Readonly<{
      candidate: TextEditCandidate;
      defaultBranchRef: string;
      manifest: import('@binflow/contracts').ProjectManifest;
      newValue: string;
      onStage?: (node: string) => Promise<void>;
      orbitype: OrbitypeTextPagesPort;
      productionOrigin: string;
      requestId: string;
    }>,
  ): Promise<TextEditPreviewResult> {
    await input.onStage?.('sync_editable_copy');
    const pages = await input.orbitype.listPages();
    await input.onStage?.('validate_text_edit');
    const resolved = resolveTextEditCandidate(
      pages,
      input.manifest.contentLocales,
      input.candidate.key,
    );
    if (resolved === null)
      throw new DomainError(
        'validation_error',
        'Text edit target is no longer available.',
        { code: 'text_target_not_found' },
      );
    try {
      assertTextFieldStillMatches(
        pages,
        input.candidate,
        input.manifest.contentLocales,
      );
    } catch {
      throw new DomainError(
        'validation_error',
        'Text edit target changed before execute.',
        { code: 'text_target_stale' },
      );
    }
    if (input.newValue.trim().length === 0)
      throw new DomainError(
        'validation_error',
        'Replacement text cannot be empty.',
        { code: 'text_replacement_empty' },
      );

    await input.onStage?.('render_text_patch');
    const page = pages.find((entry) => entry.id === resolved.pageId);
    if (page === undefined)
      throw new DomainError(
        'validation_error',
        'Text edit page disappeared during render.',
        { code: 'text_target_stale' },
      );
    const patchedSections = applyTextFieldPatch(page.sections, {
      field: resolved.field,
      locale: resolved.locale,
      newValue: input.newValue,
      sectionIndex: resolved.sectionIndex,
    });
    const githubPath = await resolveGithubMirrorPath(
      this.repository,
      input.defaultBranchRef,
      resolved.pageSlug,
      resolved.currentValue,
      input.manifest.content.editablePaths,
    );
    const     githubFiles: Array<{
      bytes: Uint8Array;
      mime: 'text/plain';
      path: string;
      sha256: string;
    }> = [];
    if (githubPath !== undefined) {
      const existing = await this.repository.readFileAtRef({
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
        resolved.currentValue,
        input.newValue,
      );
      const bytes = new TextEncoder().encode(updated);
      githubFiles.push({
        bytes,
      mime: 'text/plain',
        path: githubPath,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }

    await input.onStage?.('open_text_edit_pr');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'edit-text')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', resolved.pageSlug);
    const publication = await this.repository.createDraft({
      branch,
      ...(githubFiles.length === 0 ? {} : { files: githubFiles }),
      requestId: input.requestId,
      slug: resolved.pageSlug,
    });
    if (publication.headCommitSha.length < 7)
      throw new DomainError(
        'provider_final',
        'Text edit PR could not be opened.',
        { code: 'github_pr_failed' },
      );

    await input.onStage?.('apply_orbitype_draft');
    await input.orbitype.applySectionPatches({
      patches: [{ pageId: resolved.pageId, sections: patchedSections }],
    });

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

    return {
      deployment,
      patch: {
        candidate: resolved,
        ...(githubPath === undefined ? {} : { githubPath }),
        newValue: input.newValue,
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
      orbitype: OrbitypeTextPagesPort;
      patch: TextEditPatchArtifact;
      productionOrigin: string;
      pullRequestId: string;
    }>,
  ): Promise<TextEditPublishResult> {
    await input.onStage?.('merge_github');
    const merged = await this.repository.merge({
      expectedHeadSha: input.expectedHeadSha,
      pullRequestId: input.pullRequestId,
    });

    await input.onStage?.('publish_orbitype_pages');
    const pages = await input.orbitype.listPages();
    const page = pages.find(
      (entry) => entry.id === input.patch.candidate.pageId,
    );
    if (page === undefined)
      throw new DomainError(
        'provider_final',
        'Text edit page is missing after merge.',
        { code: 'orbitype_pages_patch_failed' },
      );
    const patchedSections = applyTextFieldPatch(page.sections, {
      field: input.patch.candidate.field,
      locale: input.patch.candidate.locale,
      newValue: input.patch.newValue,
      sectionIndex: input.patch.candidate.sectionIndex,
    });
    try {
      await input.orbitype.applySectionPatches({
        patches: [{ pageId: input.patch.candidate.pageId, sections: patchedSections }],
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Orbitype pages patch failed after GitHub merge.',
        { code: 'orbitype_pages_patch_failed' },
      );
    }

    await input.onStage?.('verify_production');
    const productionUrl = `${input.productionOrigin.replace(/\/$/u, '')}${input.patch.previewRoute}`;
    await verifyProductionTextVisible(productionUrl, input.patch.newValue);
    await input.onStage?.('completed');

    const urls = Object.freeze({
      page: productionUrl,
    });
    return {
      mergeCommitSha: merged.mergeCommitSha,
      previewRoute: input.patch.previewRoute,
      publication: {
        baseCommitSha: input.expectedHeadSha,
        branch: '',
        files: input.patch.githubPath === undefined ? [] : [input.patch.githubPath],
        headCommitSha: merged.mergeCommitSha,
        pullRequestId: input.pullRequestId,
        pullRequestUrl: '',
      },
      urls,
    };
  }
}

export type EditTextExecuteInput = Extract<EditTextInput, { mode: 'execute' }>;

export {
  applyTextFieldPatch,
  buildTextEditKey,
  discoverEditableCopy,
  resolveTextEditCandidate,
  searchEditableCopy,
  type TextEditCandidate,
} from './discover-editable-copy.js';
