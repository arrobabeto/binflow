# ADR-0060: Edit theme image for Shopify Liquid (`edit_image_shopify`)

- Status: Accepted
- Date: 2026-09-04
- Supersedes: None
- Superseded by: None

## Context

ADR-0059 enrolls `shopify_liquid` themes without Vercel or Shopify Admin API.
Greenfield themes ship an ADR-0058 Surface Inventory. Operators need a first
content capability that replaces allowlisted theme image slots via GitHub.

Related binding decisions unchanged: ADR-0042 (isolation), ADR-0052 (Orbitype
`edit_image` remains Astro-only), ADR-0058 (inventory vocabulary), ADR-0059
(enrollment).

## Decision

1. Capability id **`edit_image_shopify@1`** on stack `shopify-liquid`, command
   `/edit_image`, `allowedProfiles: ['shopify_liquid']` only.
2. Discovery reads `binflow/surface-inventory.yaml` (`kind: image`,
   `publication_target: github_theme`). Missing/empty inventory fails closed at
   tool time (not enrollment Validate).
3. Publication: GitHub PR **overwrites** the inventory `sample` path in place
   when it is under `assets/**` (so Liquid `asset_url` keeps resolving). Stamped
   sibling filenames only when sample is missing or not an asset path. Preview
   artefact for approval binding is the PR head SHA (synthetic
   `theme-preview:{prId}`). Client Telegram **does not** get storefront
   `?binflow_preview=` or Pull Request link buttons (those do not show the
   change). Confirm-target shows the current asset via live CDN URL scraped
   from `productionOrigin` HTML when possible, else GitHub raw on the
   production branch. No Vercel wait, no Orbitype patch, no Admin API.
4. Approvals: client Approve/Cancel (bound to head SHA) then admin before merge
   (medium risk update). Client copy explains the change appears live after
   admin merge.
5. Do not reuse `workflow.edit_image@1` / Orbitype executors against Liquid.

6. **Amended by ADR-0061:** on zero matches, Telegram may offer **Deep search**
   (remap inventory + one re-query). Publish revalidate uses
   `publication.files`, not an empty file list. Remap nodeKind
   `images.remap_surface_inventory@1` is Shopify-only.

7. **Asset overwrite (2026-09-06):** stamped hashed siblings were a bug —
   Liquid kept the old filename and the storefront did not change. In-place
   overwrite of `assets/**` samples is required.

8. **Client preview UX (2026-09-06):** fake storefront preview query and PR
   buttons removed from client notice; target confirm attaches a visible
   current-image URL (CDN preferred).

## Consequences

- Positive: elayva and similar themes can assign a first image tool after
  enrollment.
- Cost: theme preview is PR/storefront-query based until Admin API lands.
- Risk: Theme Editor dual-edit vs GitHub — GitHub remains Binflow SoT for
  allowlisted slots (ADR-0058).
- Freshness: incomplete YAML is recoverable via deep search / push sync
  (ADR-0061), not by inventing allowlists inside the executor.

## Verification

- Spec `docs/specs/edit-image-shopify.md`.
- Conformance registers `workflow.edit_image_shopify@1`.
- Assignment only for `shopify_liquid`; Astro `edit_image` unchanged.
- Inventory unit tests; offline test-tool audit after ship.

## See also

- [ADR-0059](0059-shopify-liquid-enrollment.md)
- [ADR-0058](0058-editable-surface-contract.md)
- Spec: [edit-image-shopify.md](../specs/edit-image-shopify.md)
