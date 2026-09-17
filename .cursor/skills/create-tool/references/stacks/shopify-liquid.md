# Stack contract: shopify-liquid

| Field | Value |
|-------|-------|
| Catalog stack | `shopify-liquid` |
| Project profile | `shopify_liquid` |
| Pilot reference | elayva (theme with `binflow/surface-inventory.yaml`) |
| Empty catalog at ACTIVE | **Yes** |
| Required credentials | GitHub App (theme repo), OpenAI, Telegram client; **`productionDomain` required** |
| Enrollment | No Vercel; no Shopify Admin API; no Orbitype. Locales: pilot monolingual `en` + `translationPolicy: none` (ADR-0046). Surface inventory recommended (ADR-0058), not a Validate blocker. |
| Implementation guide | TBD until first tool ships (`docs/guides/` optional later) |
| BSI implementer brief | [docs/briefs/bsi/shopify-liquid.md](../../../../docs/briefs/bsi/shopify-liquid.md) (content tools require inventory) |

## Path / route conventions

- Theme root is a Shopify OS 2.0 Liquid theme (sections, snippets, templates,
  assets, config, locales).
- Allowlisted surfaces: ADR-0058 inventory at `binflow/surface-inventory.yaml`
  plus `data-bf-*` markers in Liquid.
- First tools:
  - `edit_image_shopify` (`/edit_image`): inventory `kind: image`,
    `publication_target: github_theme` (assets / image settings).
  - `edit_text_shopify` (`/edit_text`): inventory `kind: copy`, patches Liquid
    schema `"default"` for the locator setting id (GitHub PR).
- Preview / approval: client Approve/Cancel binds PR head SHA; no Vercel.
  Storefront `?binflow_preview=` is not used for client CTAs (ADR-0060/0063).
- Branch pattern: `bot/{projectKey}/{capability}/...` (align with platform
  convention; do not reuse Webbin path builders).

## Production origin

- Freeze `deployment.productionOrigin` from enrollment `productionDomain`
  (HTTPS storefront).
- Client-visible production links use that origin only (ADR-0048). Never default
  to webbin.com.mx or Astro pilot URLs.

## Ports / ADR-0042

- Publication: **GitHub theme** for allowlisted image and copy slots.
- OpenAI: scoped to this stack’s image/text capability schemas (text v1 is
  deterministic collection — budget minimal).
- **Do not** add Shopify Admin product/collection mutation ports in the first
  ship.
- **Do not** wire Vercel for this profile.
- Do not widen Astro (`astro_repo` / `astro_orbitype`) shared factory defaults.
- Catalog: capabilities bind only to `shopify_liquid` / `shopify-liquid`.

## Rematerialize triggers

`editablePaths` / inventory-derived allowlists, `productionOrigin`,
publicationTargets, locale collections. After change: rematerialize + verify
version and fields landed (noop is failure if field still missing).

## Telegram / copy

- Production / storefront buttons: enrolled `productionDomain` only.
- Client approval for theme tools: **Approve/Cancel only** (SHA binding). Do
  not put storefront `?binflow_preview=` or Pull Request link buttons on the
  client notice (ADR-0060 §8 / ADR-0063).
- No Webbin (`/articulos`) or Bistro Astro path examples in client copy.
- Customization: voice/audience only — no theme paths or model ids in LLM
  customization prose.

## Live smoke gates

1. One polling worker; client bot not send-only.
2. Enrollment Validate without Vercel / Shopify Admin / Orbitype.
3. `ACTIVE` with zero capability bindings, then assign `edit_image_shopify`
   and/or `edit_text_shopify` only for this profile.
4. Pairing on dedicated client bot; `/help` replies.
5. After create-tool: image/text edit produces branch/PR; client Approve/Cancel
   then admin merge; production URL host matches enrollment domain.
6. Assigning Astro tools to this project fails closed.

## Failure checklist (stack-specific)

| # | Check |
|---|--------|
| 1 | GitHub theme binding verify (owner/repo/branch) |
| 2 | No Vercel required in Validate |
| 3 | Empty catalog allowed at ACTIVE |
| 4 | Inventory preferred at tool runtime; missing → empty allowlist / fail closed |
| 5 | `edit_image_shopify` / `edit_text_shopify` profile gate = `shopify_liquid` only |
| 6 | productionOrigin from enrollment domain |
| 7 | Theme Editor dual-edit: GitHub remains SoT for allowlisted fields (ADR-0058) |
| 8 | Astro tools / shared ports unchanged (ADR-0042) |
| 9 | Single Telegram poller |
| 10 | Locales from manifest only |

## Freeze vs existing stacks

Do not change `astro_repo` / Webbin or `astro_orbitype` / Bistro enrollment,
executors, path builders, or shared-port defaults. Dashboard changes limited to
profile select + Shopify enrollment fields. Do not reuse Astro `edit_image`
executors against Liquid.
