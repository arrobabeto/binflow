# Development standards

## Workflow

1. Read applicable canonical documents and ADRs.
2. Document intended behavior and acceptance criteria before code.
3. Create/supersede an ADR for durable architectural decisions.
4. Implement the smallest coherent vertical slice.
5. Add tests at the appropriate layers.
6. Update canonical docs and changelog to match actual behavior.
7. Run verification and report exact results.

## Definition of Ready

A change is ready for implementation when:

- Goal, user and success criteria are documented.
- In/out-of-scope behavior is explicit.
- Public contracts and state transitions are defined.
- Security, tenancy, retention and approval impact is reviewed.
- Failure/retry/recovery behavior is specified.
- Acceptance tests are listed.
- Durable decisions have an accepted/proposed ADR.

## Definition of Done

A change is complete only when:

- Implementation matches current canonical documentation.
- Relevant unit, contract, integration, E2E and security tests pass.
- All externally visible states and errors are handled.
- Idempotency and retries are tested for external mutations.
- Observability and operational behavior are documented.
- Affected product, scope, architecture, contracts, workflow, data, security, integration, testing and operations docs are updated.
- `docs/CHANGELOG.md` contains the change.
- ADRs are added or superseded when decisions changed.
- PR documentation-impact section is complete.
- No secrets, production data or unrelated changes are included.

Documentation may not be deferred to a follow-up issue or PR.

## TypeScript standards

Runtime/toolchain baseline:

- Node.js 24 LTS.
- pnpm workspaces with the repository-pinned pnpm version.
- Deployable services build and run through versioned Docker images from Phase 0.

- Strict TypeScript; no unchecked `any` at domain/provider boundaries.
- Zod schemas define external input/output and are inferred into TypeScript types.
- Domain errors are typed and mapped once at API/worker boundaries.
- Pure policy/state logic is framework-independent.
- Provider SDK objects remain inside adapters.
- Functions receive explicit tenant/project context rather than ambient globals.
- Dates use UTC instants internally and validated ISO strings in contracts.
- Secrets are represented by opaque references and resolved only inside adapters.

## Application boundaries

- API handlers validate/authenticate and call application services; they do not execute workflows inline.
- Workers execute graph nodes; graph nodes call typed ports.
- Dashboard uses API contracts and never imports database repositories into browser bundles.
- Repositories require tenant context and enforce optimistic versions.
- Tool definitions cannot expose internal publish/merge/secret operations.

## Database changes

- Every migration is versioned, reviewed and documented.
- Additive/backward-compatible migrations precede deployments that need new fields.
- Destructive migrations require data migration, backup and rollback documentation.
- RLS policies and tenant tests change with tenant-owned tables.
- Active workflow/checkpoint compatibility must be preserved or explicitly migrated.

## External side effects

- Create a durable command/request before calling a provider.
- Use idempotency keys or reconciliation reads.
- Store provider identifiers and result state.
- Do not wrap slow network calls in database transactions.
- Never repeat merge/publication solely because a response was lost.

## Error taxonomy

Stable categories:

- `validation_error`
- `authentication_error`
- `authorization_error`
- `policy_denied`
- `conflict_error`
- `budget_exceeded`
- `credential_unavailable`
- `provider_retryable`
- `provider_final`
- `internal_error`

User messages are localized and actionable; logs retain technical identifiers without secrets.

## Branches and commits

- Binflow development uses short-lived feature branches and reviewed PRs once Git is initialized.
- Generated project changes use the branch pattern defined by that project manifest.
- Do not mix Binflow application changes with pilot-site content/configuration changes.
- Commits are intentional and scoped; no force push to protected/shared branches.

## Reviews

Review order:

1. Product/scope and documentation accuracy.
2. Authorization, tenant isolation and security.
3. State, idempotency and failure recovery.
4. Contracts and compatibility.
5. Tests and observability.
6. Code clarity and performance.

## Documentation checks

CI runs `node scripts/check-docs.mjs`, format checking, lint, strict type checking, tests, builds and Compose validation. Reviewers additionally confirm:

- Relative links resolve.
- Examples match contracts.
- Decision log matches ADR status.
- No implementation behavior is documented only in a PR description.
- No current behavior depends solely on the original context document.

## Local verification commands

```text
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
node scripts/check-docs.mjs
docker compose -f infra/compose/local.yml config --quiet
```

Database schema changes are generated with `pnpm db:generate` and applied with `pnpm db:migrate`. Generated SQL and RLS changes must be reviewed before they are committed.
