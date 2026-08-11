# Binflow repository instructions

These instructions apply to the entire repository.

## Documentation-first development

Binflow is documentation-first. Before implementing a feature or changing behavior:

1. Read `docs/README.md` and every canonical document it routes to for the affected subsystem.
2. Confirm that the proposed behavior is already documented.
3. If it is not documented, update the product/technical documentation and add or amend an ADR before implementation.
4. Implement only the behavior described by the approved documentation.
5. Finish the change by updating all affected documentation and `docs/CHANGELOG.md` in the same commit or pull request.

A code or configuration change is incomplete when its documentation is stale. Do not defer documentation to a later task or PR.

## Required documentation impact assessment

Every implementation PR must state:

- Canonical documents changed.
- ADRs added, superseded, or confirmed unchanged.
- Public contracts, schemas, states, permissions, operational steps, and tests affected.
- Migration or rollback documentation affected.

Even internal refactors must update `docs/CHANGELOG.md` and confirm whether observable behavior, architecture, operations, or security assumptions changed. Documentation-only typo fixes may omit a changelog entry when they do not alter meaning.

## Decision governance

- Accepted ADRs are binding until superseded by a new ADR.
- Do not silently change a decision in prose; link the superseding ADR and preserve history.
- Product scope changes require updates to `docs/PRODUCT.md`, `docs/SCOPE.md`, `docs/ROADMAP.md`, and, when relevant, `docs/MVP.md`.
- Public contract changes require updates to `docs/CONTRACTS.md`, tests, and migration notes.
- Security-impacting changes require updates to `docs/SECURITY.md`, the threat model, and an ADR when trust boundaries change.
- Operational changes require updates to `docs/OPERATIONS.md` before they are considered deployable.

## Repository boundaries

- Binflow is implemented only in this repository.
- `/Users/arrobabeto/Projects/webbin` is a pilot/reference repository, not part of this codebase.
- Do not modify Webbin from a local Binflow task unless the user explicitly authorizes a separate onboarding or content PR.
- Binflow may eventually operate the Webbin remote only through a scoped GitHub App and the documented workflow.
- Never copy secrets, tokens, private keys, `.env` values, or production content into documentation, prompts, fixtures, logs, or commits.

## Engineering invariants

- The LLM interprets and generates; deterministic application code authorizes and executes.
- The LLM never receives a general shell, filesystem, SQL, secret, merge, deployment, or publication tool.
- Every mutable request creates a versioned draft and exact preview before production.
- Approvals bind to the exact commit, deployment, CMS version, or signed preview artifact.
- Tenant, project, identity, capability, manifest, policy, and budget checks occur outside the model.
- PostgreSQL is the durable source of workflow state; Redis is not.
- External operations must be idempotent, traceable, and safe to retry.
- Runs freeze effective graph, node, prompt, model, manifest, rule, and policy versions.

## Verification expectations

- Use the smallest test scope that proves the change, then run the affected integration and contract suites.
- Security, tenancy, approval, state-transition, and idempotency behavior require explicit tests.
- Never claim completion without reporting the checks actually run.
- Do not weaken a guardrail or skip a required check to make a test pass.
