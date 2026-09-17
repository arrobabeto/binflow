# ADR-0063: Edit theme text for Shopify Liquid (`edit_text_shopify`)

- Status: Accepted
- Date: 2026-09-06
- Supersedes: None
- Superseded by: None
- Amends: ADR-0058, ADR-0059, ADR-0060 (lessons); ADR-0061 Deep search remains
  image-only for Shopify (not part of `edit_text_shopify` discovery)

## Context

ADR-0060 shipped `edit_image_shopify` for inventory `kind: image` slots.
Operators need the parallel copy capability for `kind: copy` rows (Liquid
schema defaults) without reusing Orbitype `edit_text` (ADR-0051 / ADR-0042).

Pilot: Elayva — `sections/*.liquid` `{% schema %}` `"default"` values tagged
via Surface Inventory (`publication_target: github_theme`).

## Decision

1. Capability id **`edit_text_shopify@1`**, executor `workflow.edit_text_shopify@1`,
   stack `shopify-liquid`, command `/edit_text`, profile `shopify_liquid` only.
2. Allowlist: inventory `kind: copy` + `publication_target: github_theme` only.
   Deny chrome / do not mutate `style_target` (future `edit_text_style_shopify`).
3. Semantics: one field per request; **literal whole-field** replacement (client
   sends new text; no LLM paraphrase). Locales: pilot monolingual `en`.
4. Mutation: read Liquid at inventory `path`; set `"default"` on the settings
   entry whose `"id"` equals the last locator segment (`settings.heading` →
   `heading`); open GitHub PR with that file only.
5. Approvals: client Approve/Cancel (SHA binding) then admin → merge. Client
   notice is Approve/Cancel only — **no** storefront `?binflow_preview=` or PR
   buttons (same UX lesson as ADR-0060 §8). Confirm shows the **live schema
   default** (or inventory sample) as `«currentValue»` — never `bf_id`.
6. Discovery UX (Astro `edit_text` parity): search is normalized substring on
   live template instance values + schema default + inventory sample. Enrichment
   indexes **area-scoped** theme templates (`home` → `index.json`, `story` →
   `page.story.json`, `bio` → `page.biophenols.json`, `pdp` → `product.json`)
   plus unique Liquid section files under bounded concurrency — **not**
   home-only heuristics and **not** blocked on recursive GitHub
   `listBlobPaths`. Read errors (rate limits, etc.) propagate; missing files
   return null. If inventory declares `story`/`bio`/`pdp` copy and enrich
   keeps **none** of those areas (sample-only home survival), fail closed with
   `surface_inventory_enrichment_failed` instead of a silent not-found.
   Style-target rows are enriched the same way for miss messaging (live heading
   text even when YAML `sample` is empty). **Zero matches** on a healthy
   catalog → not-found (+ non-home area hint when catalog includes story/bio)
   and stay on `await_target`. **No** `browse_pages`, page list, or Deep search
   (Deep search stays on `edit_image_shopify` / ADR-0061). Style-target headings
   get an explicit miss message (not editable via this capability).
   Theme inventory should still ship unique `sample` strings for every `copy`
   and `style_target` row (brief); missing Story/Bio samples make home look
   uniquely searchable when live reads fail.
7. Publish: `revalidate({ expectedFiles: publication.files })` — never `[]`.
8. Isolation: do **not** call Orbitype `EditTextExecutor` / `workflow.edit_text@1`.
9. Theme Editor overrides remain out of scope v1 (GitHub SoT).

## Consequences

- Positive: Elayva and similar themes can assign copy editing after migrate.
- Cost: no live storefront text preview until Admin API or theme preview
  wiring exists.
- Risk: dual-edit Theme Editor vs GitHub for the same setting.

## Verification

- Spec `docs/specs/edit-text-shopify.md`.
- Migration `0036_edit_text_shopify_capability`.
- Unit tests: inventory copy parse + schema default patch.
- Astro `edit_text` / `edit_text_style` unchanged.

## See also

- [ADR-0060](0060-edit-image-shopify.md)
- [ADR-0061](0061-surface-inventory-sync-and-deep-search.md)
- [ADR-0051](0051-edit-text-orbitype.md) (not superseded)
- Spec: [edit-text-shopify.md](../specs/edit-text-shopify.md)
