# ADR-0006: Exact preview and version-bound approval

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

A user can otherwise approve one draft while a different commit/version reaches production. Shared staging URLs also permit one request to overwrite another user's review.

## Decision

Every mutable request version requires an exact preview. Approval binds to request version plus commit SHA/deployment ID, CMS content version or signed WordPress artifact. Any artifact change invalidates approval. Publication always revalidates the binding and current source state.

## Consequences

- Branch URLs are useful for iteration but immutable commit URLs are approval evidence.
- Revisions necessarily create new request versions and approvals.
- Administrators cannot bypass preview; elevated roles only change required approvers.
- Shared global staging cannot replace per-version preview.

## Alternatives considered

- Approve text/diff only: rejected because rendered behavior and deployment may differ.
- Approve latest branch URL: rejected because its content can change after review.
- Admin bypass: rejected because technical version binding remains necessary.

## Verification

Tests alter SHA/deployment/version after approval and confirm publication is blocked and review reopens.
