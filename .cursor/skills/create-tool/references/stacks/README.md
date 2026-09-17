# Stack tool contracts

Per-stack requirements that **create-tool** and **test-tool** must load before
interview / audit. **new-stack** creates or updates the matching file when a
profile ships.

| Stack (catalog) | Profile | Contract |
|-----------------|---------|----------|
| `astro-repo` | `astro_repo` | [astro-repo.md](astro-repo.md) |
| `astro-orbitype` | `astro_orbitype` | [astro-orbitype.md](astro-orbitype.md) |
| `shopify-liquid` | `shopify_liquid` | [shopify-liquid.md](shopify-liquid.md) |

## How new-stack updates these

1. After the stack ADR/spec are approved, fill
   [`new-stack/references/templates/stack-tool-contract.md`](../../new-stack/references/templates/stack-tool-contract.md).
2. Write `.cursor/skills/create-tool/references/stacks/<stack>.md` (hyphenated
   stack id).
3. Add a row to this index.
4. Write **BSI stack brief** `docs/briefs/bsi/<stack>.md` from
   [`new-stack/references/templates/bsi-stack-brief.md`](../../new-stack/references/templates/bsi-stack-brief.md)
   and index [`docs/briefs/bsi/README.md`](../../../../docs/briefs/bsi/README.md).
5. Link the BSI brief from the stack tool contract table.
6. Readiness handoff must list the contract path **and** BSI brief path;
   create-tool is **blocked** until the contract file exists.

## Shared rules

- Client-visible origins and paths come from enrollment / frozen manifest — not
  shared Webbin constants (ADR-0048).
- Webbin-only prose and path layouts stay in the `astro_repo` builder or
  customization layer.
- Implementation manuals (when present) link from the stack contract.
- Site labeling: [Binflow Surface Inventory](../../../../docs/guides/binflow-surface-inventory.md)
  + per-stack brief under `docs/briefs/bsi/`.
