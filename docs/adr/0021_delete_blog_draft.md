# ADR-XXXX: Delete blog post — capability specification

- Status: Proposed
- Date: 2026-08-28
- Supersedes: None
- Superseded by: None

## Context

Generated from `/Users/arrobabeto/Projects/binflow/packages/tools/briefs/delete_blog_draft.brief.yaml` via `scaffold-tool.ts`.

## Decision

1. Add capability `delete_blog_draft@1` on stack `astro_repo`.
2. Mutation class: `destructive`.
3. Executor: `workflow.delete_blog@1`.

## Consequences

Review platform gaps before implementation (GitHub delete, catalog tombstone, verification semantics).

## Verification

- Collect title or URL; resolve to slug via catalog.
- Title-only input triggers URL confirmation before plan confirm.
- Preview PR removes manifest-declared paths only.
- Admin-only approval required.
- Catalog item status becomes deleted after successful merge.
