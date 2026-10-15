# Binflow Surface Inventory (BSI)

Single home for every BSI manual and guide: the platform convention, the
inventory schema, Shopify freshness/remap, and the per-stack implementer
briefs. Governance lives in [ADR-0058](../../adr/0058-editable-surface-contract.md)
and [ADR-0064](../../adr/0064-optional-bsi-astro.md).

## Reading order

| Order | Document | Audience |
|-------|----------|----------|
| 1 | [Binflow Surface Inventory (general)](binflow-surface-inventory.md) | Everyone — convention, opt-in rule, shared rules |
| 2 | [Editable Surface Contract](editable-surface-contract.md) | Schema, kinds, markers, inventory YAML shape |
| 3 | Stack brief under [`stacks/`](#stack-briefs) | Implementer agent building or retrofitting a site |
| — | [Surface inventory sync](surface-inventory-sync.md) | Shopify operators — remap / freshness (ADR-0061) |

## Stack briefs

| Catalog stack | Profile | Brief |
|---------------|---------|-------|
| `astro-repo` | `astro_repo` | [stacks/astro-repo.md](stacks/astro-repo.md) |
| `astro-orbitype` | `astro_orbitype` | [stacks/astro-orbitype.md](stacks/astro-orbitype.md) |
| `shopify-liquid` | `shopify_liquid` | [stacks/shopify-liquid.md](stacks/shopify-liquid.md) |
| `wordpress-rest` | `wordpress_rest` | [stacks/wordpress-rest.md](stacks/wordpress-rest.md) |

## When to use

- **Greenfield** template or theme intended for Binflow.
- **Retrofit** of an existing enrolled site (add inventory + markers without
  inventing a second tag system).
- Give the implementer agent the general guide **and** the stack brief
  **before** coding surfaces.

## New stacks

[`new-stack`](../../../.cursor/skills/new-stack/SKILL.md) **must** add
`docs/guides/BSI/stacks/<stack>.md` (hyphenated catalog id), add a row to the
stack table above, and list the path in the readiness handoff — same
expectation as the stack tool contract under
`.cursor/skills/create-tool/references/stacks/`.

## Opt-in reminder

BSI is optional for Astro profiles at enrollment. Shopify content tools already
require inventory for that stack. See the general guide and ADR-0064.
