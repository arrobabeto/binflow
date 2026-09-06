# Edit theme image (Shopify Liquid) — capability specification

Capability id: `edit_image_shopify@1`
Stack: `shopify-liquid`
Executor: `workflow.edit_image_shopify@1`
Command: `/edit_image`
Graph: `stacks/shopify-liquid/edit-image@1`
Mutation class: `update`
Binding ADR: [ADR-0060](../adr/0060-edit-image-shopify.md)

---

## 1. Three layers

- **code** — Inventory-driven `github_theme` image slots only. Replace asset via
  GitHub PR. Preview = PR URL + storefront preview query. No Admin API /
  Orbitype / Vercel.
- **manifest** — `content.surfaceInventoryPath` (default
  `binflow/surface-inventory.yaml`); `editablePaths`;
  `deployment.productionOrigin`; `publicationTargets: ['github_theme']`.
- **customization** — Optional collection hints only. No paths, models, or
  approval overrides.

## 2. Content contract

- Source of truth: theme repo Surface Inventory (`kind: image`,
  `publication_target: github_theme`) per ADR-0058.
- Replacement **overwrites** the inventory `sample` path in place when it is a
  theme asset under `assets/**` (so Liquid `asset_url` keeps working). Stamped
  sibling filenames are only used when `sample` is missing or not an asset path.
  Do not publish under legacy `assets/images/` unless that is the sample path.
- Theme Editor `image_picker` overrides that point away from the Git asset are
  out of scope for v1 (GitHub SoT for allowlisted slots per ADR-0058).
- Confirm UI shows the **current** asset: prefer a live CDN URL found on the
  enrolled storefront HTML for the sample basename; else GitHub raw on the
  production branch. Never use `productionOrigin/assets/...` (404 on Shopify).
- Client approval notice is Approve/Cancel only (no fake `?binflow_preview=` or
  Pull Request buttons). Change is visible on the live site after admin merge.
- Locales: inventory `locales` are informational; one slot replace applies once
  (theme asset is shared).

## 3. Capability inputs `[CODE]`

Reuses `editImageInputSchema` (`collect` | `execute`) from
`packages/contracts`. Collection steps:

`await_target` → (`browse_pages` →)? (`disambiguate`)? → `confirm_target` →
`await_replacement` → `ready` → execute.

When search finds **zero** matches, Shopify collection enters **`browse_pages`**:
Telegram lists unique inventory `area` values (when any exist), one stacked
button per area, plus **Deep search** and Cancel. Deep search (once per
request) runs `images.remap_surface_inventory@1`, auto-merges an inventory-only
PR when the YAML changed, reloads production inventory, and re-runs the original
query (`pendingSearchQuery`). Still zero → definitive not-found. Choosing an
area loads that area’s images into `discoveredTargets` and continues as
single-match confirm or multi-match `disambiguate`. Cancel returns to
`await_target`. Astro `edit_image` never enters `browse_pages` or deep search.

Collect fields (Shopify): `deepSearchAttempted`, `pendingSearchQuery`
(optional).

## 4. Graph pipeline `[CODE]`

| node.id | nodeKind | kind |
|---------|----------|------|
| `remap_surface_inventory` | `images.remap_surface_inventory@1` | effect (collection / on-demand) |
| `sync_inventory_images` | `images.sync_inventory_images@1` | effect |
| `validate_image_edit` | `images.validate_theme_edit@1` | compute |
| `render_theme_image_patch` | `images.render_theme_patch@1` | compute |
| `open_image_edit_pr` | `images.open_theme_edit_pr@1` | effect |
| `record_theme_preview` | `images.record_theme_preview@1` | compute |
| `awaiting_client_approval` | `workflow.awaiting_client_approval@1` | interrupt |
| `awaiting_admin_approval` | `workflow.awaiting_admin_approval@1` | interrupt |
| `merge_github` | `publication.merge_github@1` | effect |
| `verify_production` | `images.verify_theme_production@1` | effect |
| `completed` | `workflow.completed@1` | compute |

Runtime: `ThemeImageWorkflowRuntime` + `EditThemeImageExecutor`. Synthetic
preview deployment row binds approvals (`theme-preview:{prId}`); no Vercel wait.
Publish revalidate uses `publication.files`. Remap is shared with the inventory
freshness contract ([ADR-0061](../adr/0061-surface-inventory-sync-and-deep-search.md)).

## 5. Client-facing messages

Reuse Astro `edit_image` Telegram copy helpers (`edit-image-ingress`) for
guidance, disambiguation, target confirm, replacement prompt, and plan confirm.
Disambiguation and **browse-pages** pick buttons use `actionRows` (one button
per Telegram row) so labels stay readable. After a failed search, browse-pages
asks which page (`area`) holds the image; **Deep search** remaps inventory;
Cancel returns to target search.
Target confirm includes `photoUrl` when a live CDN or GitHub raw URL resolves.
Client approval uses Shopify-specific copy + Approve/Cancel only (no preview/PR
URL buttons). Binding still uses PR head SHA internally.

## 6. Typed validation errors `[CODE]`

- `surface_inventory_missing` — inventory YAML absent at tool time.
- `surface_inventory_empty` — no `kind:image` / `github_theme` rows.
- `image_target_not_found` — search finds no allowlisted image.
- `image_target_ambiguous` — more than one match (disambiguation UI).
- `image_replacement_missing` — plan confirm without replacement.
- `image_replacement_invalid` — bad URL / mime / size.
- `github_pr_failed` — theme image PR cannot be opened.
- `inventory_remap_failed` — deep search / remap could not update inventory.
- `inventory_remap_pending` — remap in progress (reserved for async webhook path).

## 7. Stack rollout

1. Apply migrations `0033` (profile ship marker) and `0034`
   (`edit_image_shopify@1`), then `pnpm db:migrate`.
2. Assign capability only when project profile is `shopify_liquid`.
3. Rematerialize enrolled manifests after inventory / `editablePaths` changes.
4. Do **not** add this binding to `astro_*` default catalogs.

## 8. Verification

- Inventory sync fails closed when YAML missing.
- Search matches `bf_id` / section / sample; ambiguous returns numbered list.
- Miss → Deep search once; Astro path has no deep-search CTA.
- confirm_target shows current sample path in text plus a fetchable image URL
  (CDN preferred) when resolvable; Confirm / Not this one / Cancel.
- Replacement overwrites `assets/**` sample path in the GitHub PR.
- Client approval has no Preview/PR link buttons; Approve/Cancel only.
- Replacement accepts Telegram photo or HTTPS URL.
- Preview message includes PR URL and productionDomain preview query.
- After client approve, admin approval required before merge; revalidate file list matches PR.
- NL ingress edit-image phrases dispatch to `edit_image_shopify` when bound.
- Astro `edit_image` path unchanged (Orbitype + Vercel).
