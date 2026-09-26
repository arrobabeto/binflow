# Feature spec: Shopify Liquid enrollment

- Slug: `shopify-liquid-enrollment`
- Status: Approved for implementation
- Primary type: `stack_profile`
- Secondary types: `dashboard`, `integration`, `capability` (first tool handoff)
- Date: 2026-09-04
- Owner: platform

## Problem

Binflow only enrolls Astro profiles (`astro_repo`, `astro_orbitype`). Operators
need to enroll **Shopify Online Store 2.0 Liquid themes** (GitHub theme repo +
storefront), with Telegram pairing, and ship a first **`edit_image`** capability
that uses the Editable Surface Contract inventory — starting with pilot
**elayva**.

## Actor and outcome

- Actor: `platform_owner` (dashboard); client uses Telegram after pairing.
- Success criteria:
  - Select profile `shopify_liquid` in enrollment.
  - Register/verify GitHub App (theme repo), OpenAI, Telegram client bot;
    require `productionDomain`.
  - Reach `ACTIVE` with **zero** capability bindings, then assign
    `edit_image` for this stack.
  - Pairing works on the dedicated client bot.
  - First tool: inventory-driven image slot replace (`kind: image`,
    `publication_target: github_theme`) with branch/PR + theme preview URL.
- Freeze (must not change):
  - `astro_repo` / Webbin and `astro_orbitype` / Bistro enrollment, tools,
    executors, and shared-port defaults.
  - Dashboard UX beyond profile selector + Shopify enrollment fields.
  - Global admin Telegram topology.
  - ADR-0042 fail-closed scopes for Astro tools.

## Identity

- Stack id (hyphen): `shopify-liquid`
- Project profile (underscore): `shopify_liquid`
- Selectable enrollment: **yes** (after implementation)
- Pilot: elayva (`binflow/surface-inventory.yaml` already present in theme)

## Behavior

### In scope

- Profile `shopify_liquid` + catalog stack `shopify-liquid`.
- Enrollment without Vercel and without Shopify Admin API (v1).
- Empty capability catalog at `ACTIVE`.
- Manifest/global profile stubs for validation.
- Telegram pairing policy identical to other client bots.
- Documentation and stack tool contract for create-tool `edit_image`.
- Implementation handoff: enrollment first, then create-tool for `edit_image`
  (may be same impl wave if ordered: contracts → enrollment → create-tool).

### Out of scope

- Shopify Admin API / product or collection mutation.
- `edit_text`, `edit_text_style`, blog/Articles tools in this ship.
- Requiring surface inventory at Validate (recommended; not a blocker).
- Shopify webhooks, Theme App Extensions, App Proxy.
- Changing Astro tools or unrelated dashboard behavior.

### Failure modes

- Missing GitHub/OpenAI/Telegram/`productionDomain` → fail-closed Validate.
- Assigning Astro tools to `shopify_liquid` → profile incompatible.
- `edit_image` without inventory → empty allowlist / fail closed at tool time
  (not at enrollment Validate).
- Theme Editor dual-edit vs GitHub → GitHub theme remains Binflow source of
  truth for allowlisted fields (ADR-0058).

### Acceptance criteria

1. Operator can create enrollment with `shopify_liquid`.
2. Required credentials verify; no Vercel/Orbitype/Shopify Admin required.
3. Pairing activates; client bot responds; empty catalog allowed.
4. After create-tool: `edit_image` assignable only to `shopify_liquid`.
5. Astro regression suites unchanged.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 2 rule change (SCOPE/ROADMAP + ADR-0059) | Approve | 2026-09-04 |
| Empty catalog ACTIVE; no Admin API; no inventory Validate block | Confirm | 2026-09-04 |
| First tool `edit_image`; preview branch/PR | Confirm | 2026-09-04 |

## Documentation impact assessment

Required by [`AGENTS.md`](../../AGENTS.md):

- Canonical documents changed: `SCOPE.md`, `ROADMAP.md`, `PRODUCT.md` (roles/
  profiles touch), `ONBOARDING.md`, `ENROLLMENT.md`, `DASHBOARD.md`,
  `INTEGRATIONS.md`, `CONTRACTS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`,
  `TESTING.md`, `OPERATIONS.md` (as needed), `CHANGELOG.md`, `adr/README.md`,
  `DECISIONS.md`, this spec.
- ADRs added: **ADR-0059**. Confirmed unchanged: ADR-0007, ADR-0042, ADR-0058.
- Public contracts: `projectProfile` enum + enrollment config for Shopify.
- Migration: profile enum / DB check when implementation lands (documented in
  OPERATIONS then).
- Tests: enrollment empty-catalog; Astro freeze; later create-tool for
  `edit_image`.

## Compatibility

- Tools until create-tool: none.
- ADR-0042: GitHub/OpenAI scoped to Shopify `edit_image`; no widen Astro
  factories.
- Inventory: prefer ADR-0058 when present at tool runtime.

## Handoff

- Readiness handoff: yes (this skill Phase 4).
- Implementation: **separate** Agent session (enrollment), then
  [`create-tool`](../../.cursor/skills/create-tool/SKILL.md) for `edit_image`
  using [`.cursor/skills/create-tool/references/stacks/shopify-liquid.md`](../../.cursor/skills/create-tool/references/stacks/shopify-liquid.md).
- Operator: [`ENROLLMENT.md`](../ENROLLMENT.md) section B / Shopify notes.

## References

- ADR-0059, ADR-0058, beverage brief
  [`docs/briefs/shopify-beverage-theme-agent-brief.md`](../briefs/shopify-beverage-theme-agent-brief.md)
- Guide [`docs/guides/editable-surface-contract.md`](../guides/editable-surface-contract.md)
- Pilot theme inventory: elayva `binflow/surface-inventory.yaml`
