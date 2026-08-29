# ADR-0028: Idempotent publication after GitHub merge

- Status: Accepted
- Date: 2026-08-19
- Supersedes: None
- Superseded by: [ADR-0029](0029-client-visible-production-origin.md) for
  client-visible production URL last-resort hostnames only

## Context

Publication revalidates the approved PR, merges once, then waits for the
production deployment and builds client-visible URLs from the project domain.
A live Webbin request merged on GitHub and then failed while selecting that
domain because production custom domains are often assigned to the production
git branch. The request was marked `FAILED_FINAL` without recording the merge
commit. A later resume required the PR to still be open, so a successful merge
could never complete.

## Decision

1. Revalidation accepts an already-merged PR whose head SHA and file set still
   match the approved preview. Combined commit status is required only while
   the PR is open.
2. Merge remains at most once: an already-merged PR returns its merge commit
   SHA. The merge commit is persisted on the pull request and publication
   attempt before waiting for production.
3. Production URL selection prefers a verified custom domain with no redirect.
   A domain assigned to the production git branch is preferred. Client-visible
   production URLs when that list is empty are defined by
   [ADR-0029](0029-client-visible-production-origin.md): the pilot production
   origin, never a unique `*.vercel.app` deployment hostname.
4. A post-merge production failure is resumed from provider state. Recovery
   re-queues `FAILED_FINAL` publication attempts that still lack a production
   deployment, not only `internal_error`.

## Consequences

- GitHub can show MERGED while Binflow is still verifying production; that is
  a recoverable publication, not a new content change.
- Operators can retry a request that already merged without opening a second PR.

## Alternatives considered

- Treating any closed PR as a conflict: rejected because it strands an already
  merged article.
- Using the unique Vercel deployment hostname as production: rejected; that
  hostname is preview-grade and changes per deployment.

## Verification

GitHub tests revalidate a merged PR with the approved head. Vercel tests select
a production-branch custom domain. Workflow publication persists the merge
commit before a production-wait failure and a later resume can complete.
