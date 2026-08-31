# ADR-0051: Edit page text for Astro + Orbitype

- Status: Proposed
- Date: 2026-08-31
- Supersedes: None
- Superseded by: None

## Context

`astro_orbitype` clients need to replace allowlisted marketing copy (paragraphs
and non-H1 section titles) with exact literal text. The change must dual-write
GitHub CMS mirrors and Orbitype `pages.sections`, show a Vercel preview, and
require client preview approval plus admin publication approval before merge.

Bistro Astro apps read Orbitype at runtime (including on Vercel preview
deployments). A GitHub-only preview therefore does not show the proposed copy.
Orbitype has no separate draft environment for page section updates.

Existing capabilities must remain unchanged: `update_menu` continues to patch
menu PDFs and CTA hrefs only; blog and delete tools keep their graphs and
approval policies.

## Decision

1. Register capability `edit_text@1` on stack `astro-orbitype` / profile
   `astro_orbitype` with executor `workflow.edit_text@1`.
2. Collection interviews for locale (when multilingual), target substring,
   disambiguation, target confirm, replacement text, and plan confirm.
   Substring search only locates the allowlisted field; execute replaces the
   **entire field value** with the client’s literal `newValue` (not a partial
   in-field splice). Surgical excerpt wrapping belongs to `edit_text_style`
   (ADR-0053), not this tool.
3. Execute graph: open GitHub PR → wait Vercel preview → **temporary
   Orbitype pages patch** (after snapshot) → client approve/cancel → admin
   approval → merge → `publish_orbitype_pages` (idempotent final patch) →
   verify.
4. **Temporary live CMS mutation:** because the site serves Orbitype live,
   preview applies the new text to published rows so the client can review the
   real change. Before apply, persist a restore snapshot in the patch artifact.
5. **Compensating restore:** on client cancel, admin reject, or failure after
   the temporary write, resume reason `restore_orbitype_preview` rewrites the
   snapshot. This is not general automatic rollback (SCOPE carve-out).
6. Implement discovery and patching in `@binflow/text`; wire runtime/ingress
   additively.
7. Policy `astro-orbitype-text-edit@1` requires `client` + `admin` approvals and
   preview.

## Consequences

- Positive: client sees the proposed copy on the live-backed preview surface.
- Negative: during the approval window the production site shows the proposed
  text until approve+merge finalizes or cancel/reject restores.
- Negative: GitHub mirror resolution depends on slug-based paths under
  `cms/collections/**`.
- Operational: migrate before dashboard assignment; rematerialize manifests only
  when `editablePaths` change.

## Alternatives considered

- GitHub-only preview (no Orbitype until merge) — rejected for Bistro; preview
  still reads CMS and hides the change.
- True Orbitype page drafts — unavailable on the pilot (no draft env for
  pages).
- LLM paraphrase — rejected; literal replacement only.
- Client-only approval — rejected; admin gate required before merge.

## Verification

- Package tests for discovery, literal whole-field patch, snapshot restore.
- Cancel / admin reject enqueue `restore_orbitype_preview`.
- Conformance: catalog, policies, contracts, runtime registry.
- Manual pilot on Bistro.
- CTAs, commands, and NL dispatch for other tools unchanged (ADR-0042).
