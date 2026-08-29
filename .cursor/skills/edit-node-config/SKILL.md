# Edit Node Config

Edit base model, effort, or rules for an existing tool node in the repository catalog.

## Preconditions

1. Read ADR-0030 and the target `node.yaml` / `rules.md`.
2. Prefer PRs; do not invent models outside the allowlist in `packages/tools/src/load.ts` (`modelAllowlist`, `effortLevels`).

## Steps

1. Locate `packages/tools/stacks/<stack>/<tool>/nodes/<nn>-<node_id>/node.yaml`.
2. For `kind: agent` only:
   - Set `model` from the workload allowlist.
   - Set `effort` for `workload: text`.
   - Optionally edit `rules.md` or `rulesRef` (warn if shared: changing `shared/rules/*` affects all tools that reference it).
3. Run `pnpm --filter @binflow/tools test`.
4. Update `docs/CHANGELOG.md` and `docs/INTEGRATIONS.md` when defaults change.
5. Never edit executors, permissions, or graph topology in this skill unless a separate ADR requires it.

## Output

Summarize the node path, old/new model and effort, and whether shared rules were touched.
