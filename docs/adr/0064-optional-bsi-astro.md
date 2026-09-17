# ADR-0064: Binflow Surface Inventory (BSI) — general convention + per-stack briefs

- Status: Accepted
- Date: 2026-09-14
- Supersedes: None
- Superseded by: None
- Amends: [ADR-0058](0058-editable-surface-contract.md)

## Context

ADR-0058 defines the Editable Surface Contract (`bf_id`, field kinds, markup
markers, Surface Inventory YAML). Shopify Liquid tools already **require** that
inventory. Astro tools still discover fields via heuristics. Early docs framed
BSI as Astro-template-only; operators need a **platform** convention with one
general guide and a **technical implementer brief per catalog stack**.

Public name: **Binflow Surface Inventory (BSI)** — synonymous with ADR-0058
Surface Inventory (`binflow/surface-inventory.yaml` + `data-bf-*`).

## Decision

1. **BSI is a Binflow-wide convention.** Canonical overview:
   [`docs/guides/binflow-surface-inventory.md`](../guides/binflow-surface-inventory.md).
   Schema remains
   [`docs/guides/editable-surface-contract.md`](../guides/editable-surface-contract.md).

2. **Per-stack implementer briefs are mandatory for every catalog stack.** Path:
   `docs/briefs/bsi/<stack>.md` (hyphenated stack id), indexed in
   [`docs/briefs/bsi/README.md`](../briefs/bsi/README.md). Each brief covers
   stack language, locators, `publication_target`, markers, containers,
   backgrounds, greenfield + retrofit checklists. Live stacks today:
   `astro-repo`, `astro-orbitype`, `shopify-liquid`.

3. **`new-stack` must ship a BSI brief** for the new stack (same bar as the
   stack tool contract under `create-tool/references/stacks/`). Missing BSI
   brief is a docs gap that blocks readiness completion.

4. **Opt-in vs fail-closed is stack/tool specific.**
   - `astro_repo` / `astro_orbitype`: BSI optional at enrollment; no BSI →
     unchanged heuristics; valid BSI → capabilities **prefer** inventory when
     they know how to read it (fallback if incomplete). Executor migration is
     separate.
   - `shopify_liquid` content tools that already require inventory keep that
     fail-closed behavior.

5. **Reserved kinds (declare-only across stacks).** `video`, `overlay`,
   `container`; image `presentation: background` (+ `data-bf-presentation`) for
   CSS backgrounds on divs/sections. Identification only until dedicated tools
   consume them.

6. **Naming.** Public name **Binflow Surface Inventory (BSI)**. Artifact path
   `binflow/surface-inventory.yaml`. Markers `data-bf-id`, `data-bf-kind`,
   `data-bf-section`, optional `data-bf-presentation`.

## Consequences

- Positive: agents always get general rules + stack-precise locators.
- Positive: new stacks cannot ship without BSI documentation.
- Cost: maintain one brief per stack; keep stubs for moved paths.
- Risk: dual discovery on Astro until tools prefer inventory.

## Alternatives considered

- **Astro-only BSI docs** — rejected; convention is platform-wide.
- **Single mega-brief for all stacks** — rejected; languages differ too much.
- **Require BSI for all Astro enrollments** — rejected; opt-in remains.

## Related documents

- [Binflow Surface Inventory](../guides/binflow-surface-inventory.md)
- [Editable Surface Contract](../guides/editable-surface-contract.md)
- [BSI stack briefs](../briefs/bsi/README.md)
- [ADR-0058](0058-editable-surface-contract.md)
- [new-stack skill](../../.cursor/skills/new-stack/SKILL.md)
