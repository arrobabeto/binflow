# Edit theme text (Shopify Liquid) — capability specification

Capability id: `edit_text_shopify@1`  
Stack: `shopify-liquid`  
Executor: `workflow.edit_text_shopify@1`  
Command: `/edit_text`  
Graph: `stacks/shopify-liquid/edit-text@1`  
Mutation class: `update`  
Risk: medium · `requiresPreview: true` (SHA binding, not Vercel)

---

## 1. Three layers

- **code** — Inventory-driven `github_theme` copy slots only. Patch Liquid
  `{% schema %}` setting `"default"` via GitHub PR. Client approval binds the
  PR head SHA. No Admin API / Orbitype / Vercel. No fake storefront preview
  query or PR buttons on the client notice.
- **manifest** — `surfaceInventoryPath`; `editablePaths`; `productionOrigin`;
  `publicationTargets.github_theme`.
- **customization** — Optional collection hints only. No paths, models, or
  approval overrides.

## 2. Content contract

- SoT: `binflow/surface-inventory.yaml` rows with `kind: copy` and
  `publication_target: github_theme`.
- Each row: `bf_id`, `area`, `section`, `path` (`.liquid`), `locator`
  (e.g. `settings.heading`), optional `sample`, `locales`.
- Mutation target: in `path`, schema setting `id` = last segment of `locator`.

## 3. Capability inputs

`editTextShopifyInputSchema` (collect / execute):

| Collect step | Purpose |
|--------------|---------|
| `await_target` | Client sends a fragment of the **current** text |
| `disambiguate` | Numbered pick list (label = text snippet) |
| `confirm_target` | Show `«currentValue»`; Confirm / Not this one / Cancel |
| `await_replacement` | Literal new text |
| `ready` | Plan confirm → queue execute |

Zero matches stay on `await_target` with an Astro-like not-found message
(mentions non-home catalog areas when present). There is **no** `browse_pages`
/ Deep search step (unlike `edit_image_shopify`). Search enrichment indexes
**area-scoped** theme templates (story/bio/pdp) and unique Liquid schema
defaults under bounded concurrency; GitHub read errors must not be swallowed
into a home-only catalog. If non-home inventory areas yield zero enriched rows,
collection surfaces `surface_inventory_enrichment_failed` instead of a silent
not-found. Style-target headings are enriched for miss messaging even when
inventory `sample` is empty.

### Theme inventory (Elayva / pilots)

Ship unique `sample` on every `kind: copy` **and** `kind: style_target` row
(from live schema default or `templates/*.json` instance). Home-only samples
make Story/Bio appear broken when live GitHub reads fail. Correct stale samples
(e.g. story eyebrow/heading) before merging to the enrolled `productionBranch`.

Execute requires `targetKey`, `newValue`, `contentLocale` (pilot `en`).

## 4. Graph pipeline

| node.id | nodeKind | kind |
|---------|----------|------|
| `sync_inventory_copy` | `text.sync_inventory_copy@1` | effect |
| `validate_text_edit` | `text.validate_theme_edit@1` | compute |
| `render_theme_text_patch` | `text.render_theme_patch@1` | compute |
| `open_text_edit_pr` | `text.open_theme_edit_pr@1` | effect |
| `record_theme_preview` | `text.record_theme_preview@1` | compute |
| `awaiting_client_approval` | `workflow.awaiting_client_approval@1` | interrupt |
| `awaiting_admin_approval` | `workflow.awaiting_admin_approval@1` | interrupt |
| `merge_github` | `publication.merge_github@1` | effect |
| `verify_production` | `text.verify_theme_production@1` | effect |
| `completed` | `workflow.completed@1` | compute |

## 5. Client-facing messages

- Guidance / miss: Astro `edit_text` parity (“Send the **current text**…”,
  “Try a longer excerpt”).
- Confirm / plan: `«currentValue»` (live schema default), never `bf_id`.
- Client approval: Approve / Cancel only (`renderThemeTextApprovalNotice`).
- Admin → merge → production origin URL.

## 6. Typed validation errors

- `surface_inventory_missing`
- `surface_inventory_empty`
- `text_target_not_found`
- `text_target_ambiguous`
- `text_replacement_missing`
- `github_pr_failed`

## 7. Stack rollout

1. `pnpm db:migrate` (migration `0036_edit_text_shopify_capability`).
2. Dashboard: assign `edit_text_shopify` to Elayva (`shopify_liquid` only).
3. Smoke: `/edit_text` → search `home.intro` → replace → Approve → admin → merge
   → verify schema default on storefront (no Theme Editor override).

## 8. Out of scope (v1)

- `edit_text_style_shopify`
- Orbitype / Shopify Admin API / Theme Editor `templates/*.json` patches
- Real storefront preview of the new string before merge

## 9. Isolation

Astro Orbitype `edit_text` / `edit_text_style` remain unchanged (ADR-0051).
Dispatch: `/edit_text` and NL edit-text phrases route to `edit_text_shopify`
when that capability is bound on the project.
