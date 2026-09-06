# ADR-0061: Surface inventory sync on push and deep search

- Status: Accepted
- Date: 2026-09-06
- Supersedes: None
- Superseded by: None
- Amends: [ADR-0058](0058-editable-surface-contract.md), [ADR-0060](0060-edit-image-shopify.md)

## Context

Shopify Liquid tools treat `binflow/surface-inventory.yaml` in the **client
theme repo** as the allowlist of editable surfaces (ADR-0058). That contract is
correct, but freshness failed in practice:

1. Markers (`data-bf-*`) can exist in Liquid while the YAML omits them.
2. Each theme push can add sections/pages without updating inventory.
3. `edit_image_shopify` fail-closed on miss with no escape hatch left operators
   stuck outside Telegram.
4. Separately, theme-image publish called GitHub `revalidate` with
   `expectedFiles: []`, so admin merge almost always failed with
   “GitHub PR changed after preview approval.”

Related decisions unchanged: ADR-0042 (isolation — Astro `edit_image`
untouched), ADR-0059 (enrollment), ADR-0060 (capability shape).

## Decision

1. **Inventory freshness contract.** The theme repo remains SoT for the YAML.
   Binflow tools **read** inventory; they do not invent ad-hoc allowlists.
   Remap **writes** that YAML back into the theme via a GitHub PR (merge allowed
   for inventory-only sync under this ADR).

2. **Push → sync (client agent + platform job).** Every push/PR that touches
   `sections/**`, `templates/**`, `snippets/**`, `assets/**`, markers, or the
   inventory file must refresh the YAML. Primary gate for pilots: theme-agent
   brief + `check-inventory-sync` (see
   [`docs/guides/surface-inventory-sync.md`](../guides/surface-inventory-sync.md)).
   Binflow exposes a shared remap pipeline (`images.remap_surface_inventory@1`)
   for on-demand and future signed GitHub `push` / merged-PR webhooks once App
   webhook delivery is activated in production.

3. **Remap algorithm.** Scan Liquid (and similar) for `data-bf-id` /
   `data-bf-kind` / `data-bf-section`. Merge into existing YAML: **preserve**
   stable `bf_id`s and hand-tuned `locator` / `sample` / `alt_locator`; **add**
   new markers; orphan rows keep an explicit note (no silent mass delete).

4. **Deep search (Shopify `edit_image_shopify` only).** On zero search matches,
   Telegram offers **Deep search** (plus page browse when areas exist) and
   Cancel. Deep search runs remap, auto-merges an inventory-only PR when the
   YAML changed, reloads production HEAD inventory, and re-runs the original
   query once per request (`deepSearchAttempted`). Still zero → definitive
   not-found.

5. **Publish revalidate.** `EditThemeImageExecutor.publish` passes
   `expectedFiles: input.publication.files` (not `[]`).

6. **Isolation.** Collection CTAs, action `deep_search_inventory`, and remap
   nodeKind apply only to `edit_image_shopify` / `shopify-liquid`. Astro
   Orbitype `edit_image` behavior and copy stay unchanged.

## Consequences

- Positive: miss → explicit resync path; Story/new pages become searchable after
  remap without leaving Telegram; admin merge unblocked.
- Cost: inventory auto-merge on deep search mutates the theme repo (inventory
  file only); operators must still keep markers honest.
- Risk: Theme Editor dual-edit vs GitHub remains; remap cannot invent `bf_id`
  without markers.
- Deferred: production GitHub App push webhook route (same remap job); reuse of
  remap for Shopify `edit_text_*` and greenfield stacks (separate ADR).

## Alternatives considered

- Scrape markers at every search instead of YAML: rejected; breaks inventory-first
  contract and makes allowlist non-reviewable in git.
- Deep search opens PR only (no merge): rejected for Telegram UX; execute would
  still read stale production YAML.
- Require human inventory PRs for every deep search: rejected; too slow for
  live client chat.

## Verification

- Spec `docs/specs/edit-image-shopify.md` (deep search + remap).
- Guide `docs/guides/surface-inventory-sync.md`.
- Unit tests: remap merge; theme publish `expectedFiles`; deep-search action
  wiring / copy isolation from Astro.
- Offline tool audit after ship; Astro `edit_image` unchanged.

## See also

- [ADR-0058](0058-editable-surface-contract.md)
- [ADR-0060](0060-edit-image-shopify.md)
- Guide: [surface-inventory-sync.md](../guides/surface-inventory-sync.md)
