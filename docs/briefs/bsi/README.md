# Binflow Surface Inventory (BSI) — stack briefs

Per-stack **implementer** documents for labeling client sites with BSI. Read
the platform guide first, then the brief for the stack you are building or
retrofitting.

| Order | Document |
|-------|----------|
| 1 | [Binflow Surface Inventory (general)](../../guides/binflow-surface-inventory.md) |
| 2 | [Editable Surface Contract](../../guides/editable-surface-contract.md) (schema) |
| 3 | **This folder** — stack brief matching the catalog stack |

## Index

| Catalog stack | Profile | Brief |
|---------------|---------|-------|
| `astro-repo` | `astro_repo` | [astro-repo.md](astro-repo.md) |
| `astro-orbitype` | `astro_orbitype` | [astro-orbitype.md](astro-orbitype.md) |
| `shopify-liquid` | `shopify_liquid` | [shopify-liquid.md](shopify-liquid.md) |

## When to use

- **Greenfield** template or theme intended for Binflow.
- **Retrofit** of an existing enrolled site (add inventory + markers without
  inventing a second tag system).
- Paste the stack brief into an implementer agent session **before** coding
  surfaces.

## New stacks

[`new-stack`](../../../.cursor/skills/new-stack/SKILL.md) **must** add
`docs/briefs/bsi/<stack>.md` (hyphenated catalog id), update this README, and
list the path in the readiness handoff — same expectation as the stack tool
contract under `.cursor/skills/create-tool/references/stacks/`.

## Opt-in reminder

BSI is optional for Astro profiles at enrollment. Shopify content tools already
require inventory for that stack. See the general guide and ADR-0064.
