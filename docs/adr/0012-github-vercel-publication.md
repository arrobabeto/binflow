# ADR-0012: GitHub and Vercel publication model

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: ADR-0013 for the GitHub App registration permission set only

## Context

Repo-backed projects need isolated concurrent changes, exact previews and a production state aligned with version control. Webbin's existing human skill uses shared `develop`, which is unsuitable for concurrent platform jobs.

## Decision

Use a GitHub App whose installation tokens are least-privilege for each operation. [ADR-0013](0013-github-app-administrative-registration.md) defines the explicitly approved, broader registration permission ceiling and mandatory runtime downscoping. Each request branches from the current remote production branch, owns one PR and uses Vercel Preview associated with its head SHA. After version-bound approvals, Binflow revalidates and merges the PR; the production branch then produces the deployment Binflow verifies. Webbin requests branch from and target `main`.

## Consequences

- GitHub remains source of truth.
- Shared `develop` and permanent capability branches are not used by Binflow.
- Configuration/onboarding changes use separate human-approved PRs.
- Vercel URL promotion without corresponding Git merge is not the normal publication path.
- Preview side effects and environment separation are onboarding requirements.

## Alternatives considered

- Write directly to `main`: rejected because preview/review is impossible.
- Shared `develop`: rejected because jobs contaminate one another.
- Promote preview without merge: rejected because production and Git diverge.
- Personal PAT: rejected for scope, lifetime and audit reasons.

## Verification

E2E confirms branch isolation, allowed paths, PR/head/deployment correlation, approval invalidation and production merge-commit verification.
