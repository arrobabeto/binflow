# ADR-XXXX: Delete portfolio project — capability specification

- Status: Proposed
- Date: 2026-08-28
- Supersedes: None
- Superseded by: None

## Context

Generated from `/Users/arrobabeto/Projects/binflow/packages/tools/briefs/delete_project_astro.brief.yaml` via `scaffold-tool.ts`.

## Decision

1. Add capability `delete_project_astro@2` on stack `astro_repo`.
2. Mutation class: `destructive`; requiresPreview: `false`.
3. Executor: `workflow.delete_project@1`.
4. Close ADR-0040 gaps: GitHub DELETE via PR, verification semantics (404 vs 301), catalog tombstone, admin policy, no Vercel preview unless documented.

## Consequences

Review platform gaps before implementation. Post-ship: migrate, default bindings, rematerialize (`post-ship-ops.md`).

## Verification

- Collect title or URL; resolve to slug via catalog.
- Title-only input triggers URL confirmation before plan confirm.
- Deletion PR removes manifest-declared portfolio paths only.
- Admin-only approval required against PR head.
- Catalog item status becomes deleted after successful merge.
- Old project URLs return 404 in production.
