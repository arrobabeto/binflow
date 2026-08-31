import { createHash } from 'node:crypto';

import type { UpdateMenuInput } from '@binflow/contracts';
import { DomainError } from '@binflow/domain';

import type {
  DraftPublication,
  RepositoryPublicationPort,
} from '@binflow/blog';

import {
  applyMenuHrefPatches,
  buildVersionedMenuPdfPath,
  discoverMenuCtas,
  publicUrlForMenuPdfPath,
  type MenuCtaCandidate,
  type OrbitypePageSnapshot,
} from './discover-menu-ctas.js';

export type OrbitypeMenuPagesPort = Readonly<{
  applySectionPatches(
    input: Readonly<{
      patches: ReadonlyArray<
        Readonly<{ pageId: string; sections: unknown }>
      >;
    }>,
  ): Promise<void>;
  listPages(): Promise<readonly OrbitypePageSnapshot[]>;
}>;

export type UpdateMenuExecutionInput = Readonly<{
  extraMenuCtaKeywords?: readonly string[];
  input: Extract<UpdateMenuInput, { mode: 'execute' }>;
  manifest: import('@binflow/contracts').ProjectManifest;
  onStage?: (node: string) => Promise<void>;
  orbitype: OrbitypeMenuPagesPort;
  pdfBytes: Uint8Array;
  productionOrigin: string;
  requestId: string;
  requestVersionId: string;
}>;

export type UpdateMenuExecutionResult = Readonly<{
  mergeCommitSha: string;
  menuPdfPublicPath: string;
  menuPdfPublicUrl: string;
  publication: DraftPublication;
  selectedCtaCount: number;
  updatedPageSlugs: readonly string[];
}>;

const assertEditablePdfPath = (
  path: string,
  editablePaths: readonly string[],
): void => {
  const allowed = editablePaths.some((pattern) => {
    if (pattern.endsWith('/*.pdf') && pattern.startsWith('public/documents/'))
      return path.startsWith('public/documents/') && path.endsWith('.pdf');
    return pattern === path;
  });
  if (!allowed)
    throw new DomainError(
      'validation_error',
      'Menu PDF path is outside manifest editablePaths.',
      { code: 'manifest_path_denied' },
    );
};

const selectedCandidates = (
  pages: readonly OrbitypePageSnapshot[],
  discovered: readonly MenuCtaCandidate[],
  selectedKeys: readonly string[],
): readonly MenuCtaCandidate[] => {
  const discoveredByKey = new Map(discovered.map((cta) => [cta.key, cta]));
  const selected = selectedKeys.map((key) => {
    const candidate = discoveredByKey.get(key);
    if (candidate === undefined)
      throw new DomainError(
        'validation_error',
        'Selected menu CTA is no longer available.',
        { code: 'menu_cta_stale' },
      );
    const page = pages.find((entry) => entry.id === candidate.pageId);
    if (page === undefined)
      throw new DomainError(
        'validation_error',
        'Selected menu CTA page is missing.',
        { code: 'menu_cta_stale' },
      );
    const sections = page.sections;
    if (!Array.isArray(sections))
      throw new DomainError(
        'validation_error',
        'Selected menu CTA sections are invalid.',
        { code: 'menu_cta_stale' },
      );
    const section = sections[candidate.sectionIndex];
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      throw new DomainError(
        'validation_error',
        'Selected menu CTA section is missing.',
        { code: 'menu_cta_stale' },
      );
    const currentHref = (section as Record<string, unknown>)[candidate.field];
    if (typeof currentHref !== 'string' || currentHref !== candidate.currentHref)
      throw new DomainError(
        'validation_error',
        'Selected menu CTA href changed before execute.',
        { code: 'menu_cta_stale' },
      );
    return candidate;
  });
  if (selected.length === 0)
    throw new DomainError(
      'validation_error',
      'Menu update requires at least one selected CTA.',
      { code: 'menu_selection_empty' },
    );
  return selected;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const MENU_PDF_VERIFY_POLL_MS = 5_000;
const MENU_PDF_VERIFY_TIMEOUT_MS = 120_000;

export const verifyMenuPdfAccessible = async (
  url: string,
  options: Readonly<{
    pollIntervalMs?: number;
    timeoutMs?: number;
  }> = {},
): Promise<void> => {
  const pollIntervalMs = options.pollIntervalMs ?? MENU_PDF_VERIFY_POLL_MS;
  const deadline =
    Date.now() + (options.timeoutMs ?? MENU_PDF_VERIFY_TIMEOUT_MS);
  let lastStatus: string | undefined;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 200) return;
      lastStatus = String(response.status);
    } catch {
      lastStatus = 'unreachable';
    }
    if (Date.now() + pollIntervalMs > deadline) break;
    await sleep(pollIntervalMs);
  }
  throw new DomainError(
    'provider_final',
    'Production menu PDF did not return HTTP 200.',
    { code: 'menu_pdf_not_accessible', status: lastStatus ?? 'unknown' },
  );
};

const verifyButtonHrefs = (
  pages: readonly OrbitypePageSnapshot[],
  selected: readonly MenuCtaCandidate[],
  pdfUrl: string,
): void => {
  for (const candidate of selected) {
    const page = pages.find((entry) => entry.id === candidate.pageId);
    if (page === undefined || !Array.isArray(page.sections))
      throw new DomainError(
        'provider_final',
        'Production page is missing after menu publish.',
        { code: 'menu_button_href_mismatch' },
      );
    const section = page.sections[candidate.sectionIndex] as Record<
      string,
      unknown
    >;
    const href = section?.[candidate.field];
    if (href !== pdfUrl)
      throw new DomainError(
        'provider_final',
        'Production menu button href does not match published PDF URL.',
        { code: 'menu_button_href_mismatch' },
      );
  }
};

export class UpdateMenuExecutor {
  public constructor(
    private readonly repository: RepositoryPublicationPort,
  ) {}

  public async execute(
    input: UpdateMenuExecutionInput,
  ): Promise<UpdateMenuExecutionResult> {
    await input.onStage?.('sync_pages');
    const pages = await input.orbitype.listPages();
    const discovered = discoverMenuCtas(
      pages,
      input.manifest.contentLocales,
      input.extraMenuCtaKeywords ?? [],
    );
    await input.onStage?.('validate_menu_update');
    const selected = selectedCandidates(
      pages,
      discovered,
      input.input.selectedCtaKeys,
    );
    const menuPdfPublicPath =
      input.input.menuPdfPublicPath.length > 0
        ? input.input.menuPdfPublicPath
        : buildVersionedMenuPdfPath(input.requestVersionId);
    assertEditablePdfPath(
      menuPdfPublicPath,
      input.manifest.content.editablePaths,
    );
    const menuPdfPublicUrl = publicUrlForMenuPdfPath(
      input.productionOrigin,
      menuPdfPublicPath,
    );
    await input.onStage?.('render_menu_artifacts');
    const patchesByPage = new Map<
      string,
      Array<{ field: MenuCtaCandidate['field']; href: string; sectionIndex: number }>
    >();
    for (const candidate of selected) {
      const current = patchesByPage.get(candidate.pageId) ?? [];
      current.push({
        field: candidate.field,
        href: menuPdfPublicUrl,
        sectionIndex: candidate.sectionIndex,
      });
      patchesByPage.set(candidate.pageId, current);
    }
    const orbitypePatches = [...patchesByPage.entries()].map(
      ([pageId, patches]) => {
        const page = pages.find((entry) => entry.id === pageId);
        if (page === undefined)
          throw new DomainError(
            'validation_error',
            'Menu page disappeared during render.',
            { code: 'menu_cta_stale' },
          );
        return {
          pageId,
          sections: applyMenuHrefPatches(page.sections, patches),
        };
      },
    );
    await input.onStage?.('open_menu_update_pr');
    const branch = input.manifest.repository.branchPattern
      .replace('{capability}', 'update-menu')
      .replace('{request-id}', input.requestId)
      .replace('{slug}', 'menu');
    const publication = await this.repository.createDraft({
      branch,
      files: [
        {
          bytes: input.pdfBytes,
          mime: 'application/pdf',
          path: menuPdfPublicPath,
          sha256: createHash('sha256').update(input.pdfBytes).digest('hex'),
        },
      ],
      requestId: input.requestId,
      slug: 'menu',
    });
    if (
      publication.headCommitSha.length < 7 ||
      !publication.files.includes(menuPdfPublicPath)
    )
      throw new DomainError(
        'provider_final',
        'Menu update PR does not contain the expected PDF artifact.',
        { code: 'github_pr_failed' },
      );
    await input.onStage?.('apply_orbitype_draft');
    if (orbitypePatches.length === 0)
      throw new DomainError(
        'validation_error',
        'Menu Orbitype patch set is empty.',
        { code: 'orbitype_pages_patch_failed' },
      );
    await input.onStage?.('merge_github');
    const merged = await this.repository.merge({
      expectedHeadSha: publication.headCommitSha,
      pullRequestId: publication.pullRequestId,
    });
    await input.onStage?.('publish_orbitype_pages');
    try {
      await input.orbitype.applySectionPatches({ patches: orbitypePatches });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'provider_final',
        'Orbitype pages patch failed after GitHub merge.',
        { code: 'orbitype_pages_patch_failed' },
      );
    }
    await input.onStage?.('verify_production');
    await verifyMenuPdfAccessible(menuPdfPublicUrl);
    const refreshedPages = await input.orbitype.listPages();
    verifyButtonHrefs(refreshedPages, selected, menuPdfPublicUrl);
    await input.onStage?.('completed');
    return {
      mergeCommitSha: merged.mergeCommitSha,
      menuPdfPublicPath,
      menuPdfPublicUrl,
      publication,
      selectedCtaCount: selected.length,
      updatedPageSlugs: [...new Set(selected.map((cta) => cta.pageSlug))].sort(),
    };
  }
}

export {
  DEFAULT_MENU_CTA_KEYWORDS,
  discoverMenuCtas,
  toggleMenuCtaSelection,
  buildVersionedMenuPdfPath,
  publicUrlForMenuPdfPath,
} from './discover-menu-ctas.js';
export type { MenuCtaCandidate, MenuCtaField, OrbitypePageSnapshot } from './discover-menu-ctas.js';
