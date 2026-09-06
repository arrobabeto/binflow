# ADR-0059: Shopify Liquid enrollment (`shopify_liquid`)

- Status: Accepted
- Date: 2026-09-04
- Supersedes: None
- Superseded by: None

## Context

Binflow enrolls Astro profiles only. Operators need a managed profile for
Shopify Online Store 2.0 Liquid themes whose content surfaces follow the
Editable Surface Contract (ADR-0058). The elayva theme already ships
`binflow/surface-inventory.yaml` and `data-bf-*` markers. ROADMAP listed Shopify
as future TBD; SCOPE named Orbitype as the prior post-MVP expansion.

Related binding decisions that remain unchanged: ADR-0007 (bot topology),
ADR-0020 (catalog bindings), ADR-0042 (tool isolation), ADR-0045 (Orbitype
enrollment pattern as precedent), ADR-0058 (surface contract).

## Decision

1. **Profile and stack.** Introduce project profile `shopify_liquid` and catalog
   stack directory id `shopify-liquid`. The profile is **selectable** for
   enrollment once implemented.

2. **Empty catalog at ACTIVE.** Like `astro_orbitype` (ADR-0045), enrollment may
   reach `ACTIVE` with zero capability bindings. Tools are assigned after
   create-tool ships them.

3. **Required integrations (v1).** GitHub App bound to the **theme** repository,
   OpenAI (per-client), Telegram client bot, and enrollment `productionDomain`
   (frozen as `deployment.productionOrigin`, ADR-0048). **Not** required in v1:
   Vercel, Orbitype, Shopify Admin API.

4. **No new Shopify credential kind in v1.** Theme mutation for the first tool
   uses GitHub (`publication_target: github_theme`). Admin API is a later ADR.

5. **Surface inventory.** ADR-0058 remains binding for greenfield themes.
   Validate **does not** fail solely for a missing
   `binflow/surface-inventory.yaml` (product choice). Content tools **prefer**
   inventory + markers when present and fail closed / empty allowlist when
   absent at tool runtime.

6. **Locales.** Pilot default is monolingual `en` with translation policy
   `none`. No Webbin-style hard overlays; operator configures enrollment fields.

7. **First capability (separate create-tool).** Inventory-driven `edit_image`
   for `shopify_liquid` only: allowlist `kind: image` rows with
   `github_theme`, branch/PR + theme preview URL. Must not reuse
   `astro_orbitype` executors against Liquid.

8. **Freeze.** Existing Astro enrollments, tools, executors, and dashboard
   behavior outside profile select + Shopify enrollment fields must not change.

## Consequences

- Positive: elayva and future Liquid themes enroll without waiting for Admin
  API; tools map to inventory `bf_id`s.
- Cost: preview/publish path differs from Vercel Astro; ops docs must say so.
- Risk: dual Theme Editor vs GitHub edits — GitHub remains Binflow SoT for
  allowlisted fields.
- SCOPE/ROADMAP expand; next ADR if Admin API or additional tools land.

## Alternatives considered

- Require Shopify Admin + Vercel at enrollment: rejected for v1 (elayva image
  slots are theme GitHub).
- Require inventory at Validate: rejected by product choice; tools enforce
  allowlist at runtime.
- Reuse Orbitype `edit_image` executor: rejected (ADR-0030 / ADR-0058 layering).

## Verification

- Spec `docs/specs/shopify-liquid-enrollment.md` accepted.
- Enrollment tests: empty catalog ACTIVE; no Vercel/Admin required; Astro
  regression green.
- create-tool blocked until
  `.cursor/skills/create-tool/references/stacks/shopify-liquid.md` exists.
- `edit_image` only assignable to `shopify_liquid`.

## See also

- [ADR-0058](0058-editable-surface-contract.md)
- [ADR-0045](0045-astro-orbitype-enrollment.md)
- [docs/guides/editable-surface-contract.md](../guides/editable-surface-contract.md)
- Spec: [shopify-liquid-enrollment.md](../specs/shopify-liquid-enrollment.md)
