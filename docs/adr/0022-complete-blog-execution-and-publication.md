# ADR-0022: Complete blog execution and publication

- Status: Accepted
- Date: 2026-08-18

## Context

The durable request kernel stops after a client confirms a plan. The MVP needs
to turn that frozen version into an exact bilingual Webbin change without
giving a model repository, deployment, approval or publication authority.

## Decision

1. `@binflow/blog` owns deterministic category normalization, embedding-based
   catalog similarity, Webbin rendering, path validation, AVIF validation and
   the typed provider ports used by `create_blog_draft@1`.
2. The workflow freezes the manifest, input, policy, catalog revision and model
   configuration before generation. OpenAI produces schema-constrained Spanish
   source content, an idiomatic English adaptation and an image source; code
   renders and validates the three allowed artifacts.
3. Generated bodies and image bytes live in the S3-compatible artifact store.
   PostgreSQL stores ownership, digests, lifecycle and the complete audit trail.
4. The GitHub adapter may create only the documented request branch, two
   Markdown files, one AVIF and one PR. Installation tokens are per-operation,
   repository-ID scoped, permission-downscoped, short lived and never stored.
5. A preview is approvable only when its deployment is ready and bound to the
   exact PR head SHA. Client and optional admin approvals bind to the request
   version, head SHA and deployment ID and become stale after any revision.
6. Publication is a separate resume command. It re-reads all preconditions,
   merges at most once, waits for the production deployment and verifies both
   localized routes. Reconciliation reads provider state before retrying.
7. Existing and normalized categories require client approval. A new category
   adds platform-owner approval. The model cannot alter this decision.
8. Live provider mutations require the explicit deployment switch
   `BINFLOW_LIVE_EXECUTION_ENABLED=true`. The switch is an operational kill
   switch, not an authorization bypass; all normal policy and approval checks
   still apply.

## Consequences

- Unit and E2E tests use typed fakes and cannot mutate Webbin.
- A local operator can keep real credentials verified while exercising the
  complete workflow in safe fake-provider mode.
- Enabling live execution can create a Webbin branch and PR after client plan
  confirmation, but cannot merge without exact approvals.
- A real Webbin article remains a separate acceptance action supplied and
  approved by the owner.

## Rollback

Disable live execution first, stop workers, reconcile any recorded open branch
or PR, and restore the coordinated pre-release application/database backup.
Never delete provider objects without their recorded IDs and an explicit
operator decision.
