# ADR-0049: Update menu PDF for Astro+Orbitype restaurant sites

- Status: Accepted
- Date: 2026-08-31
- Amended: 2026-08-31 (opt-in CTA selection interview)
- Supersedes: None
- Superseded by: None
- Extends: [ADR-0030](0030-declarative-tools-and-client-customization.md),
  [ADR-0038](0038-capability-runtime-registry.md),
  [ADR-0042](0042-tool-isolation-and-shared-ports.md),
  [ADR-0045](0045-astro-orbitype-enrollment.md),
  [ADR-0047](0047-create-blog-orbitype-dual-write.md),
  [ADR-0048](0048-enrolled-client-production-origin.md),
  [ADR-0026](0026-telegram-inline-action-buttons.md)

## Context

Bistro and future `astro_orbitype` restaurant pilots need to replace menu PDF
links on existing CMS page CTAs without creating blog posts or new buttons.
Today Telegram ingress persists **images only**; Orbitype ports cover **`posts`**
(blog) but not **`pages`** section patches.

Operators want:

- Client uploads a menu PDF (max 10 MB) via Telegram.
- Versioned file under `public/documents/` (never overwrite prior menus).
- Discovery of menu-semantics CTAs across **all** Orbitype pages; client
  multi-selects which buttons to update.
- Dual-write: GitHub PDF commit + Orbitype `pages.sections` href patch.
- **No Vercel preview** — client approves once at plan confirm; production
  verification confirms PDF accessibility and button hrefs.

## Decision

1. **New capability.** Register `update_menu@1` on stack `astro-orbitype`,
   profile `astro_orbitype`, command `/update_menu`, executor
   `workflow.update_menu@1`. Mutation class `update`; `requiresPreview: false`.
2. **Telegram PDF ingest.** Extend `@binflow/messaging` with
   `persistInboundDocument` — `application/pdf`, max 10 MB, same attachment
   pipeline pattern as images.
3. **Ingress collection.** Before execute: PDF → discover menu CTAs →
   **opt-in** multi-select (none selected at start; client taps buttons to
   mark; `Seleccionar todos` / `Select all` / `Alle auswählen` shortcut;
   `Continuar` / `Continue` / `Weiter` advances; Cancel aborts) → plan
   confirm (`Publicar menú` / `Menü veröffentlichen` / `Publish menu`).
   Plan confirm is the **sole** client approval gate. Empty confirm stays on
   selection with “pick at least one” copy (not the no-CTAs-found message).
4. **Graph (no preview nodes).** Linear pipeline:
   `sync_pages` → `validate_menu_update` → `render_menu_artifacts` →
   `open_menu_update_pr` → `apply_orbitype_draft` → `merge_github` →
   `publish_orbitype_pages` → `verify_production` → `completed`.
5. **Orbitype pages port.** `@binflow/orbitype` gains allowlisted read/patch
   for `pages.sections` JSON (fixed SQL, no LLM SQL). Separate node kinds from
   blog `posts` publication (ADR-0042).
6. **Catalog scope.** New `catalogScope: pages` on `sync_pages` — extends
   ADR-0042; do not widen shared blog/portfolio factory defaults.
7. **Manifest.** Add `public/documents/*.pdf` to `editablePaths`; public PDF URL
   from frozen `deployment.productionOrigin` (ADR-0048).
8. **Verification.** `verify_production` checks production PDF HTTP 200 and
   selected button hrefs match the published PDF URL.

## Consequences

- Positive: Restaurant menu updates without preview deploy latency or SSO gates.
- Positive: Versioned PDF history retained in repo.
- Negative: Client does not see live site before merge; mitigated by plan summary
  (PDF filename, selected buttons) and post-merge verification.
- Platform: New permission `orbitype:content:read`; new runtime kind `update_menu`.
- Pilot: `docs/customizations/bistro-update-menu.md` for DE menu keyword matching.

## Verification

See `docs/specs/update-menu.md` §9 and brief `verification.scenarios`.
