# ADR-0041: Defer delete-blog post-deletion redirects

- Status: Accepted
- Date: 2026-08-28
- Supersedes: None
- Superseded by: None
- Amends: [ADR-0040](0040-destructive-content-capabilities.md) §2 (delete-blog redirect policy)

## Context

`delete_blog_draft@1` upserted `public/_redirects` and verified production 301
redirects after merge. Webbin deploys on Vercel with Astro `output: 'static'` and
no `vercel.json`. Vercel serves `public/_redirects` as a static asset and does
not apply Netlify-style redirect rules. Production verification therefore failed
even when deletion and merge succeeded.

Post-deletion redirects require client-repo routing configuration (for example
`vercel.json` redirects or an Astro adapter) before Binflow can manage them
safely.

## Decision

1. **Remove redirect artifacts from delete-blog execute.** Deletion PRs delete
   manifest-declared content paths only; they do not modify `public/_redirects`.
2. **Verify production absence instead of redirects.** `verify_production` uses
   `DeploymentPort.verifyAbsence` — deleted article routes must return HTTP 404
   in production after merge.
3. **Defer redirect management** until the client repository declares a
   Vercel-native redirect mechanism in manifest and Binflow implements a
   stack-specific redirect port. Search Console cleanup for removed URLs remains
   a client-repo concern until then.

## Consequences

- Delete-blog requests complete when files are removed and routes 404.
- `verifyDeletionRedirects` remains on `DeploymentPort` for future stacks that
  support enforced redirects.
- Webbin operators may add redirects manually in the client repo; Binflow does
  not verify them in MVP.

## Alternatives considered

- **Keep `_redirects` and skip verification** — rejected; false success when
  redirects never apply on Vercel.
- **Remove `verify_production` entirely** — rejected; absence verification is
  still required to prove deletion shipped.

## Verification

- `delete_blog_draft` spec and brief updated
- `@binflow/blog` and delete-blog runtime tests cover deletion-only PRs and 404
  verification
- Live delete on Webbin completes through `COMPLETED` when routes 404
