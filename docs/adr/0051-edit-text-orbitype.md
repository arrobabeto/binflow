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

Existing capabilities must remain unchanged: `update_menu` continues to patch
menu PDFs and CTA hrefs only; blog and delete tools keep their graphs and
approval policies.

## Decision

1. Register capability `edit_text@1` on stack `astro-orbitype` / profile
   `astro_orbitype` with executor `workflow.edit_text@1`.
2. Collection interviews for locale (when multilingual), target substring,
   disambiguation, target confirm, replacement text, and plan confirm.
3. Execute graph opens a GitHub PR, applies an Orbitype pages draft, waits for
   preview, then interrupts for client approve/cancel (no revision) and admin
   approval before merge/publish/verify.
4. Implement discovery and patching in isolated package `@binflow/text`; wire
   runtime, ingress, and worker branches additively without modifying existing
   tool executors.
5. Policy `astro-orbitype-text-edit@1` requires `client` + `admin` approvals and
   preview.

## Consequences

- Positive: literal copy edits with preview and dual-write on Orbitype stacks.
- Negative: GitHub mirror resolution depends on slug-based paths under
  `cms/collections/**`; sites with non-standard export layouts need manifest or
  customization follow-up.
- Operational: migrate before dashboard assignment; rematerialize manifests only
  when `editablePaths` change (already includes `cms/collections/**` for Bistro).

## Alternatives considered

- Reuse `update_menu` graph — rejected; different mutation surface and preview
  requirements.
- LLM paraphrase — rejected; user requires literal replacement only.
- Client-only approval — rejected; admin gate required before production merge.

## Verification

- Package tests for editable copy discovery and literal patch application.
- Conformance: catalog, policies, contracts, migration, and runtime registry.
- Ingress tests for action labels and NL routing.
- Manual pilot on Bistro after dashboard assignment and manifest binding.
