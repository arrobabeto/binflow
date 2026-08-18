# Testing strategy

## Principles

- Test policy and state behavior independently from models/providers.
- Use fakes for deterministic failure and concurrency cases.
- Use contract tests against recorded or controlled provider fixtures.
- Use real external pilots only for explicit acceptance stages.
- Never run destructive tests against production content.
- Every bug fix adds a regression test and updates the affected canonical documentation.
- CI must enumerate every required workspace from a clean checkout; repository ignore
  rules may exclude only the root runtime `secrets/` directory, never source packages
  such as `packages/secrets`. `pnpm check:workspaces` compares lockfile importers with
  tracked workspace manifests before dependency installation.

## Test layers

### Unit

- Zod schemas and domain value objects.
- Locale intersection and translation policy.
- Capability access and approval matrices.
- Exact capability registry version, immutable project binding, disabled-tool
  invisibility and manifest/binding fingerprint agreement.
- Request-state transitions and terminal-state enforcement.
- Category normalization/classification inputs.
- Path/field allowlists and manifest validation.
- Budget, retention, idempotency and pairing-token rules.
- Global-profile narrowing, Webbin ES/EN/source/slug invariants and rejection of
  German or `ask_each_action` for the pilot.
- Secret-envelope round trip and authentication failure.
- KEK path/length/permission validation and non-echoed CLI input enforcement.
- GitHub PEM import rejects repository-local, non-regular, oversized or non-`0600` files.
- GitHub operation-to-token permission mapping.
- Platform/tenant/project credential owner-scope and AAD isolation.
- Candidate success/supersession, permanent invalidation, transient preservation and failed-rotation rollback.
- Concurrent/out-of-order candidate activation cannot replace a newer active version.
- Strict per-provider evidence schemas reject secret-bearing or extra fields before persistence/output.
- Dashboard credential tests cover strict secret-bearing unions, keyed
  idempotency fingerprints, redacted responses/events, optimistic revisions,
  fresh-session gates and same-origin rejection.
- Runtime KEK tests accept supported read-only Docker-secret modes, retain exact
  `0600` for host files and reject any writable mount.

### Contract

- OpenAI structured outputs, refusal and usage normalization.
- Chat SDK Telegram messages, commands, buttons, files and transport modes.
- GitHub App auth, trees/commits, PR, checks and merge response normalization.
- GitHub installation repository restriction and permission-downscoped token issuance.
- Read-only OpenAI model visibility, Telegram identity/transport and GitHub App/installation verification with redacted evidence.
- GitHub `installation_audit` token has no write permission, enumerates only for the exact audit operation and is revoked/discarded.
- Vercel deployment/SHA correlation.
- Vercel credential identity and exact project/team, GitHub repository and production-branch verification without project mutation.
- S3-compatible artifact lifecycle.
- Better Auth session and TOTP behavior.
- Single-owner bootstrap is serialized, refuses existing users and never accepts
  a password argument; HTTP sign-up remains disabled.
- Password-only sessions cannot reach business APIs. TOTP or a single-use backup
  code completes login; trusted-device requests are rejected.
- Initial TOTP enrollment revokes every other password-only session so assurance
  cannot be inherited retroactively.
- Enrollment tests cover Phase 0 scope adoption, aggregate uniqueness, strict
  configuration, optimistic concurrency, idempotent replay, legal state
  transitions, stale evidence and fail-closed activation.
- Pairing-link tests prove 24-hour expiry, hash-only persistence, redacted
  idempotency receipts, one-time plaintext return/replay rejection and
  tenant/project binding.
- Manifest tests cover immutable snapshots, identical-fingerprint reuse,
  changed-fingerprint supersession, serialized project-local versions,
  provider-derived external bindings and atomic validation/audit/outbox writes.
- Session expiry, five-minute freshness, revocation, database-backed rate limits,
  Origin/CSRF enforcement and cookie flags are covered explicitly.
- LangGraph PostgreSQL checkpointer compatibility.

### Integration

- Telegram event → identity → request/outbox/queue.
- Dashboard onboarding → validation → activation → pairing.
- Plan confirmation → graph resume.
- Catalog sync → similarity decision.
- Graph → fake GitHub PR → fake deployment → approval → merge.
- Duplicate webhook/action/queue delivery.
- Revoked credential, expired approval and budget exhaustion.
- Attachment deletion after terminal state.
- Runtime-role RLS with tenant, audited platform-owner and rejected unscoped
  execution paths.
- Atomic business mutation, audit and outbox commit/rollback.
- Concurrent idempotency-key replay and processed-event deduplication.

Database lifecycle tests use an isolated PostgreSQL database through
`BINFLOW_TEST_DATABASE_URL`. CI provides `binflow_test`; local runs must point
this variable at a disposable database and never at the normal `binflow` or a
production database.

RLS suites must connect as a non-owner, non-superuser role. Tests executed only
as the migration/table owner do not count as tenant-isolation evidence.
Parallel test processes may call the migration runner; the PostgreSQL advisory
lock must serialize them without duplicate enum/table creation.
Database test files sharing one disposable database run serially because their
fixture cleanup uses transactional table truncation; concurrency behavior is
tested explicitly inside dedicated cases instead of racing suite cleanup.
The root `pnpm test` command also serializes workspace test tasks for the same
reason; individual non-database packages may still be run directly in parallel.

### End-to-end

First against a fixture Astro repository, then Webbin:

```text
client bot
→ create_blog_draft
→ confirmed plan
→ ES/EN Markdown + AVIF
→ isolated branch and PR
→ checks + Vercel preview
→ revision/approval
→ merge
→ production verification
→ audit and notifications
```

The final Webbin E2E publishes one real owner-approved article. Test content is not temporarily published and reverted merely to prove the pipeline.

## Required scenario matrix

### Telegram/input

- Natural-language request resolves correctly.
- Empty `/create_blog` returns instructions/categories.
- Incomplete request asks only for topic.
- Unpaired or different-tenant identity is rejected.
- Attachment MIME mismatch, oversized file and unsafe URL are rejected.

### Category

- Exact existing category.
- Case/whitespace normalization.
- Likely typo confirmed by client.
- New category creates preview but requires admin publication approval.
- Admin rejection returns to revision without publishing.

### Content

- Novel, related expansion and high-overlap decisions.
- Concurrent draft included in similarity.
- Claims with and without research.
- ES/EN adaptation preserves claims and valid localized links.
- German is rejected for Webbin by manifest.
- Uploaded and generated image paths.
- Similarity failure causes one deliberate regeneration or user action.

### Version and approval

- Preview/head SHA match.
- New commit invalidates approval.
- Expired/replayed callback cannot publish.
- Bot and dashboard duplicate approval remains idempotent.
- Client-only path for existing category.
- Client + admin path for new category.

### Failure and recovery

- Worker restart during model call, preview wait and approval wait.
- Redis loss after request commit.
- Delayed/duplicated GitHub or Vercel event.
- OpenAI timeout/rate limit.
- Merge succeeds but production deployment fails.
- External base branch changes before merge.

### Security

- Cross-tenant API query and object-ID guessing.
- Prompt injection in article, README and attachment.
- Path traversal and unexpected diff.
- SSRF through source URL and redirects.
- Secret scanning of logs, queue payloads, checkpoints and artifacts.
- CLI arguments/output never contain secret values and list returns redacted metadata only.
- Verification never persists provider bodies/native messages and does not mutate Telegram transport, chats or Webbin.
- A failed candidate leaves the prior active credential resolvable; concurrent verify/revoke cannot reactivate a revoked version.
- Duplicate Telegram bot IDs across bindings, tenant/project connection mismatches, project-owner/connection mismatches and unauthorized internal Webbin scopes are rejected transactionally; same-binding Telegram rotation succeeds.
- Late verification results cannot move `tested_at` backward or overwrite newer status/evidence, and activation policy failures remain redacted per-item results under `verify --all`.
- Blog tokens cannot access Administration or Workflows; separately authorized onboarding tokens cannot exceed their declared operation.
- RLS bypass attempts and platform-owner audit.
- Missing/stale `If-Match`, idempotency-key body mismatch, cross-actor replay and
  unscoped repository access.

## Documentation verification

CI introduced with implementation must:

- Validate Markdown links.
- Require `docs/CHANGELOG.md` plus relevant canonical document changes for implementation PRs.
- Validate code examples/contracts where practical.
- Fail when generated API/schema references drift from committed contracts.
- Build upstream workspace type packages before type-aware lint runs so a clean checkout cannot resolve internal imports as `any`.

## MVP quality gate

- All unit, contract, integration and security suites pass.
- No critical/high security finding remains open.
- E2E evidence records exact request, PR, SHA, deployment and production URLs.
- Local setup succeeds from an empty database and object store.
- The pinned ClamAV image exposes native `linux/arm64` and `linux/amd64`
  manifests; its Compose service becomes healthy and detects the EICAR test
  signature before attachment scanning is accepted.
- Destructive PostgreSQL integration tests refuse database names that do not end in `_test`; CI uses a disposable isolated database only.
- Documentation matches the observed behavior and acceptance evidence.
