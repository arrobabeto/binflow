# Surface inventory sync (push → YAML freshness)

Canonical contract for keeping `binflow/surface-inventory.yaml` aligned with
storefront `data-bf-*` markers. Binding ADR:
[ADR-0061](../adr/0061-surface-inventory-sync-and-deep-search.md). Vocabulary:
[editable-surface-contract.md](./editable-surface-contract.md).

## Roles

| Actor | Duty |
|-------|------|
| Theme agent / developer | On every relevant push, sync YAML + pass local check before push/PR. |
| Binflow remap job | Scan markers, merge YAML, open/merge inventory-only PR (deep search; later push webhook). |
| Content tools | **Read** production-branch inventory only; never invent allowlists. |

## Client theme gate (required for pilots)

Copy or link this guide into the theme as `binflow/AGENT-INVENTORY-SYNC.md`
(or equivalent agent rule). Hard gate:

1. Before `git push` / `gh pr create` / merge to the production branch, if the
   change touched `sections/**`, `templates/**`, `snippets/**`, `assets/**`,
   markers, or the inventory file → refresh the YAML.
2. Preserve stable `bf_id`s and hand-tuned `locator` / `sample` / `alt_locator`.
3. Add rows for new markers; do not silently delete orphans.
4. Run the theme’s inventory check script (e.g. `./binflow/check-inventory-sync`)
   and require exit 0.

## Binflow remap pipeline

Node kind: `images.remap_surface_inventory@1` (Shopify `edit_image` graph;
callable from collection **Deep search**).

1. List theme blobs under `sections/`, `snippets/`, `templates/` (and read
   existing inventory path).
2. Extract `data-bf-id`, `data-bf-kind`, `data-bf-section` from Liquid.
3. Merge into YAML (preserve existing rows; add missing markers).
4. If unchanged → no PR.
5. If changed → draft PR updating only the inventory path; deep-search path
   **auto-merges** that inventory-only PR, then tools re-read HEAD.

Push webhook activation (signed GitHub App delivery) uses the **same** remap
pipeline once production webhook cutover is live. Until then, the client agent
gate remains the primary freshness control; Deep search is the on-demand escape.

## Deep search (Telegram)

Used by `edit_image_shopify` when target search returns zero matches:

1. Offer **Deep search** (+ browse by inventory `area` when areas exist) and Cancel.
2. One deep search per request.
3. After remap + reload, re-run the original query.
4. Still zero → definitive not-found (no loop).

Astro Orbitype `edit_image` does **not** gain this CTA (ADR-0042).

## Related

- Spec: [edit-image-shopify.md](../specs/edit-image-shopify.md)
- ADR-0058 / ADR-0060 / ADR-0061
