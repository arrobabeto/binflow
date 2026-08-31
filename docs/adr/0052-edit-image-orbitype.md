# ADR-0052: Edit site image for Astro + Orbitype

- Status: Proposed
- Date: 2026-08-31
- Supersedes: None
- Superseded by: None

## Context

`astro_orbitype` clients need to replace one allowlisted image slot per request
on marketing pages or blog posts (including blog cover/hero). Page heroes and
nav/footer logos stay denied. The change must dual-write GitHub
(`imageDirectory` / `public/images/blog/edit-*` plus CMS mirrors under
`cms/collections/**`) and Orbitype `pages` / `posts`, with Vercel preview and
client + admin approval before merge.

Bistro Astro apps read Orbitype at runtime. GitHub-only preview does not show
the new image. Pointing CMS at a relative PR-only asset path also breaks live
until merge.

On multilingual projects there is no per-locale pick: one replacement asset
patches every `contentLocales` entry for the chosen slot.

Existing capabilities must remain unchanged: `edit_text`, `update_menu`, blog,
and delete tools keep their graphs and approval policies.

## Decision

1. Register capability `edit_image@1` on stack `astro-orbitype` / profile
   `astro_orbitype` with executor `workflow.edit_image@1`.
2. Collection interviews for target search, disambiguation, target confirm
   (current image photo + absolute URL in copy), replacement (Telegram photo or
   HTTPS URL), and plan confirm (all-locale note when multilingual).
3. Execute graph: open GitHub PR (relative `newPublicPath`) → wait Vercel
   preview → snapshot CMS → **temporary Orbitype patch using absolute preview
   deployment URL** for the asset → client → admin → merge →
   `publish_orbitype_content` with **relative** production path → verify.
4. Absolute preview URL avoids live 404s while the binary exists only on the PR
   head; post-merge publish rewrites CMS to the relative path served from
   production.
5. **Compensating restore:** on client cancel, admin reject, or failure after
   the temporary write, resume reason `restore_orbitype_preview` restores the
   snapshot (SCOPE carve-out; same pattern as ADR-0051).
6. Implement discovery and patching in `@binflow/images`; wire runtime/ingress
   additively.
7. Policy `astro-orbitype-image-edit@1` requires `client` + `admin` approvals and
   preview.

## Consequences

- Positive: client sees the proposed image via CMS-backed preview/live during
  the approval window.
- Negative: production briefly shows the proposed image (hotlinked from the
  preview origin) until merge rewrites to the relative path or cancel restores.
- Operational: migrate before dashboard assignment; rematerialize manifests only
  when `editablePaths` change.

## Alternatives considered

- GitHub-only preview — rejected for Bistro runtime-Orbitype fidelity.
- Temporary CMS with relative PR-only path — rejected; breaks live with 404s.
- Bistro change to serve PR `cms/collections` on preview — deferred (site work).
- True Orbitype drafts for page/post edits — unavailable on the pilot.
- LLM-generated replacements — rejected; client supplies the exact image.
- Client-only approval — rejected; admin gate required before merge.

## Verification

- Package tests: absolute preview URL at preview apply; relative on publish;
  restore snapshot.
- Cancel / admin reject enqueue `restore_orbitype_preview`.
- Conformance + ingress tests; manual pilot on Bistro.
