# Update menu (Astro + Orbitype) — capability specification

Capability id: `update_menu@1`
Stack: `astro-orbitype`
Executor: `workflow.update_menu@1`
Command: `/update_menu`
Graph: `stacks/astro-orbitype/update-menu@1`
Mutation class: `update`

Canonical decision: [ADR-0049](../adr/0049-update-menu-orbitype.md).  
Layer tags: `[CODE]`, `[MANIFEST-*]`, `[CUSTOMIZATION]`.

---

## 1. Three layers

- **code** — PDF ingest (Telegram document, max 10 MB), versioned public path, menu CTA discovery across all Orbitype pages, **opt-in** multi-select ingress (none selected at start; Select all + Continuar; Cancel on selection), dual-write GitHub PDF plus Orbitype sections patch, production verification. Plan confirm is the sole client approval gate.
- **manifest** — public/documents/*.pdf editablePaths, deployment.productionOrigin for public PDF URL, contentLocales for label matching, publicationTargets github+orbitype.
- **customization** — menuCtaKeywords in bistro-update-menu.md for DE menu button matching. No paths, models, or approval overrides.

## 2. Content contract

Document manifest paths and bundle shape before implementation.

## 3. Capability inputs `[CODE]`

Define Zod input union modes in `packages/contracts/src/index.ts`.

## 4. Graph pipeline `[CODE]`

### Graph semantics

| node.id | nodeKind | kind |
|---------|----------|------|
| `sync_pages` | `menu.sync_pages@1` | effect |
| `validate_menu_update` | `menu.validate_update@1` | compute |
| `render_menu_artifacts` | `menu.render_artifacts@1` | compute |
| `open_menu_update_pr` | `menu.open_update_pr@1` | effect |
| `apply_orbitype_draft` | `menu.apply_orbitype_draft@1` | effect |
| `merge_github` | `publication.merge_github@1` | effect |
| `publish_orbitype_pages` | `menu.publish_orbitype_pages@1` | effect |
| `verify_production` | `menu.verify_production@1` | effect |
| `completed` | `workflow.completed@1` | compute |

## 5. Client-facing messages

Selection (`select_ctas`): opt-in prompt; list with ✓ only on chosen CTAs;
selected count; CTAs `Seleccionar todos` / `Continuar` / `Cancelar` (and
`en`/`de` equivalents). Empty Continuar → pick-at-least-one copy
(`menu_selection_empty` UX), not `menu_cta_not_found`.

Plan confirm: public PDF URL + button labels; `Publicar menú` /
`Publish menu` / `Menü veröffentlichen`; Cancel localized. Admin notice
shapes per `client-facing-copy.md`.

## 6. Typed validation errors `[CODE]`

- `pdf_missing` — Execute starts without a persisted PDF artifact.
- `attachment_mime_denied` — Telegram attachment is not application/pdf.
- `attachment_too_large` — PDF exceeds 10 MB.
- `menu_cta_not_found` — No menu-semantics CTAs exist on any Orbitype page.
- `menu_selection_empty` — Client confirms button selection with zero CTAs chosen.
- `menu_cta_stale` — A selected CTA no longer exists when validate_menu_update runs.
- `orbitype_pages_patch_failed` — Orbitype rejects the pages sections patch (4xx).
- `github_pr_failed` — Menu update PR cannot be opened or updated.
- `menu_pdf_not_accessible` — Production PDF URL does not return HTTP 200.
- `menu_button_href_mismatch` — A selected button href does not match the published PDF URL.

## 7. Stack rollout

1. Run migration then `pnpm db:migrate` before dashboard assignment.
2. Add default binding to `astroRepoDefaultCapabilityBindings` when `allowedProfiles` includes `astro_repo`.
3. Rematerialize enrolled manifests after `editablePaths` changes.


## 8. Verification

- Telegram PDF up to 10 MB accepted; 11 MB returns attachment_too_large.
- Bistro discovers menu-semantics CTAs on all pages; reservation CTAs unchanged.
- Opt-in multi-select: after PDF none selected; Select all marks every
  discovered CTA; Continuar with zero CTAs keeps selection open.
- Multi-select updates only chosen ctaHref/ctaSecondaryHref fields.
- Plan confirm shows public PDF URL and button labels; no repo paths.
- Plan confirm is sole client gate; graph merges without wait_preview.
- Versioned filename public/documents/menu-{date}-{suffix}.pdf never overwrites.
- Orbitype 4xx maps to provider_final; 5xx may retry.
- verify_production checks PDF 200 and button hrefs on production origin.
+- verify_production polls the public PDF URL until HTTP 200 (CDN/deploy lag after merge).
- Dashboard assignment only for astro_orbitype profile.
- NL ingress de/es/en menu update phrases dispatch to update_menu.
- Plan confirm CTAs are Publicar menú / Menü veröffentlichen / Publish menu.
