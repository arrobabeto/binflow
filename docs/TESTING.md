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
- Pairing expiry/replay/wrong-bot behavior, cross-bot numeric-ID isolation,
  unpaired discovery denial, localized commands, update replay, stale actions
  and request create/confirm/cancel/resume after service reconstruction.
- Request RLS, optimistic concurrency, terminal guards, immutable versions and
  checkpoint monotonicity against the isolated `_test` database.
- Exact capability registry version, immutable project binding, disabled-tool
  invisibility and manifest/binding fingerprint agreement.
- Request-state transitions and terminal-state enforcement.
- Category normalization/classification inputs.
- Path/field allowlists and manifest validation.
- Blog capability category normalization, overlap blocking, bilingual
  frontmatter rendering, English title/heading adaptation, exact three-file
  path policy, true AVIF validation, budget ceilings and approval invalidation.
- Budget, retention, idempotency and pairing-token rules.
- Global-profile narrowing, Webbin ES/EN/source/slug invariants and rejection of
  German, monolingual `none`, or `ask_each_action` for the pilot.
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
  non-idle session gates and same-origin rejection.
- Dashboard theme tests assert that every solid semantic action color resolves
  to a generated palette token, preventing invisible white action text.
- Dashboard authentication regressions prove that successful TOTP and backup
  verification force a revalidated document navigation to the authenticated
  route instead of reusing an anonymous Nuxt session payload.
- Dashboard session regressions prove rolling 30-minute server expiry,
  automatic idle sign-out, restored-page revalidation and no usable protected
  navigation after expiry. Incomplete SSR session payloads are treated as
  unauthenticated rather than throwing.
- Runtime KEK tests accept supported read-only Docker-secret modes, accept the
  Docker Desktop `0600` compatibility form only with a proven `EROFS` mount,
  retain exact `0600` for host files and reject any writable mount.

### Contract

- OpenAI structured outputs, refusal and usage normalization.
- Chat SDK Telegram messages, commands, buttons, files and transport modes.
- Telegram adapter tests prove that `/start <token>` and other bot commands use
  the slash-command dispatcher, preserve their arguments and receive the same
  authorized application reply as ordinary direct messages.
- Telegram adapter tests prove that action tokens render as inline buttons
  rather than `/action` text for plan and preview, that publication-complete
  notices use live-origin URL buttons, that `callback_query` dispatch uses the
  clicking user and token as `/action <token>`, and that typed `/action`
  remains a working fallback.
- Blog and contract tests reject an English bundle that copies Spanish
  `titulo`, `seoTitulo`, FAQ questions or Markdown headings.
- GitHub App auth, trees/commits, PR, checks and merge response normalization.
  PR revalidation is a void GitHub operation and must not be treated as a missing
  publication result.
- GitHub installation repository restriction and permission-downscoped token issuance.
- Read-only OpenAI model visibility, Telegram identity/transport and GitHub App/installation verification with redacted evidence.
- GitHub `installation_audit` token has no write permission, enumerates only for the exact audit operation and is revoked/discarded.
- Vercel deployment/SHA correlation. Production route URLs use
  `https://webbin.com.mx`. Unique `*.vercel.app` deployment hostnames
  are never client-visible production URLs.
- GitHub publication tests revalidate an already-merged PR whose head and files
  still match the approved preview, and persist the merge commit before a
  later production-wait failure.
- Vercel credential identity and exact project/team, GitHub repository and production-branch verification without project mutation.
- S3-compatible artifact lifecycle.
- Production OpenAI, GitHub and Vercel adapters against controlled HTTP mocks;
  CI never enables live Webbin mutation.
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
- Client pairing tests prove that identity creation precedes response delivery,
  delivery failure remains pending, success idempotently records Telegram
  delivery and moves the enrollment to active with audit/outbox evidence.
- Manifest tests cover immutable snapshots, identical-fingerprint reuse,
  changed-fingerprint supersession, serialized project-local versions,
  provider-derived external bindings and atomic validation/audit/outbox writes.
- Session idle expiry, one-minute rolling refresh, revocation, database-backed rate limits,
  Origin/CSRF enforcement and cookie flags are covered explicitly.
- TypeScript workflow PostgreSQL checkpoint compatibility.

### Integration

- Telegram event → identity → request/outbox/queue.
- Dashboard onboarding → validation → activation → pairing.
- `astro_orbitype` enrollment: Orbitype API-key verify is required; activation
  may succeed with an empty capability catalog (ADR-0045).
- `create_blog_orbitype` dual-write (ADR-0047): GitHub draft then Orbitype CMS
  draft, Vercel preview URLs at `/posts/{draftId}/{titleSlug}`, merge_github
  then publish_orbitype; assignment only for `astro_orbitype` projects (Bistro
  pilot). Preview Astro `PUBLIC_*` env must include Production **and** Preview.
  Persisting preview evidence must tolerate GitHub PR numbers that already
  exist on another project's `pull_requests` row (unique is per `project_id`).
- Plan confirmation → graph resume.
- Catalog sync → similarity decision.
- Graph → fake GitHub PR → fake deployment → approval → merge.
- Full fake-provider request-to-publication flow, including conditional admin
  approval and production route evidence.
- Request list filters by `projectId` and `needsAdminApproval`, pages with a
  stable cursor, and projects `clientName`/`clientKey` without secrets.
- Dashboard cancellation commits the terminal state and exactly one localized
  `client.notification_requested` outbox event; an idempotent replay of the same
  cancel call adds no second event, an unresolvable conversation locale adds
  none, and client-initiated `/cancel` adds none because it answers in-thread.
- Execute failure leaves append-only stage checkpoints, redacted `failure` in
  `RequestDetail`, and a durable `request.failed_final` admin-notification
  outbox event. Stage projection never exposes secrets or raw checkpoint JSON.
  A retryable execute appends new checkpoint sequences and does not reuse
  `(graph_run_id, sequence)`.
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
→ revision plan confirm / surgical or full apply
→ revision/approval
→ merge
→ production verification
→ audit and notifications
```

The final Webbin E2E publishes one real owner-approved article. Test content is not temporarily published and reverted merely to prove the pipeline.

Admin pairing tests cover token replay, wrong-bot/user isolation, target
replacement and redacted persistence. Notification tests cover durable retry
without workflow advancement. The complete fake-provider acceptance flow runs
with `BINFLOW_LIVE_EXECUTION_ENABLED` absent or false and proves that no external
mutation adapter was constructed.

## Required scenario matrix

### Client-realistic tool audit (test-tool skill)

After a tool ships (or after UX/copy changes), run
[`.cursor/skills/test-tool/SKILL.md`](../.cursor/skills/test-tool/SKILL.md) at
`standard` depth. Parameters: `toolId`, `auditMode` (`base` | `customized`),
`clientKey`, `locale`, `environment`.

The skill:

1. Builds a scenario matrix from mutation class (see
   `references/scenario-generators.md`).
2. Runs automated baseline (tools, workflows, policies, conformance).
3. Optionally executes live Telegram scenarios (`local-live`).
4. Writes `docs/audits/<toolId>[-<clientKey>]-<YYYY-MM-DD>.md`.

Does **not** replace rows below; adds qualitative coverage for client copy, CTAs,
stuck states, and customization asks. Pilot reference:
`docs/audits/delete_blog_draft-webbin-2026-08-28.md`.

### Capability conformance (ADR-0038/0039/0042)

- `packages/workflows/test/capability-conformance.test.ts` — every loaded catalog
  tool matches `graph.yaml` version, policies registry, contracts enum, migration
  SQL, and worker runtime registry; graph version resolves from `tool.yaml`.
- Unknown capabilities fail closed in `resolveCapabilityRuntime` (no blog fallback).
- Tools with a `catalog_sync` node must declare `parameters.catalogScope`
  (`blog` \| `portfolio`) aligned with `catalogScopeForRuntimeKind` (ADR-0042).
  GitHub catalog ports require explicit non-empty `contentKinds`.

### Telegram/input

- Natural-language request resolves correctly.
- Empty `/create_blog` returns instructions/categories.
- Incomplete request asks only for topic.
- A blog message over 500 characters stores the full text in `context` with a
  provisional topic (ADR-0031); only messages over 10 000 characters are
  rejected. `interpret_brief` runs before similarity when context is present.
- `/create_project` and natural portfolio briefs enter `NEEDS_INPUT` until base
  facts (`name`, `YYYY-MM` fecha, `projectDescription`) plus required
  customization `content_schema` fields close (ADR-0035/0037); follow-up
  messages continue the same request. Upload rejects unknown content_schema
  types and reserved base field ids. Slash-command photos persist like DMs;
  photo-only text must not close string fields as `[image]`. Covers encode as
  AVIF; `read_project_url` feeds typed page evidence into generate.
- `/delete_project` and NL delete-project (verb + portfolio cue) resolve title/URL,
  sync portfolio catalog from GitHub at ingress, and require admin approval after
  deletion PR (no client preview CTAs). NL dispatch runs before create-project when
  both match.
- `/delete_blog` — same destructive pattern for blog articles (see
  `docs/specs/delete-blog-draft.md`).
- **`/update_menu`** (astro_orbitype) — PDF upload, menu CTA toggles, plan
  confirm without preview; see `docs/specs/update-menu.md` and
  `packages/menu/test/update-menu.test.ts`.
- **`/edit_text`** (astro_orbitype) — substring target, disambiguation, literal
  whole-field replacement, preview Approve/Cancel, admin before merge; see
  `docs/specs/edit-text.md` and `packages/text/test/`.
- **`/edit_text_style`** (astro_orbitype) — same targeting as text edit; stepped
  weight/size/color interview (multi OK, ≥1); one fieldKind; HEX ≤2 retries;
  target-not-found retry; wrap excerpt in styled span; isolated CTAs; preview +
  admin; cancel/reject restore fail-closed (artifact fallback); pilot sites must
  sanitize-allow style spans and render allowlisted fields via CmsText/SafeHtml;
  see `docs/specs/edit-text-style.md` and
  `packages/text/test/text-style.test.ts`.
- **`/edit_image`** (astro_orbitype) — image target search, photo confirm /
  reject loop, replacement via photo or HTTPS URL, all-locale patch, preview +
  admin (with preview link); see `docs/specs/edit-image.md` and
  `packages/images/test/`.
- Unpaired or different-tenant identity is rejected.
- Attachment MIME mismatch, oversized file and unsafe URL are rejected.
- After preview **Request changes**, free-text feedback queues
  `interpret_revision`; confirm/adjust/cancel revision-plan actions behave per
  ADR-0032. `FAILED_RETRYABLE` is shown as retrying; exhausted retries become
  `FAILED_FINAL`.

### Revision (ADR-0032)

- Title-attractiveness feedback yields `title_locales`; after confirm, body hash
  and cover digest are unchanged.
- Body delete/edit/add instructions yield `body_patch` and run through
  `apply_revision` without full regenerate when coherence allows.
- Thematically distant title proposes `full_regenerate` and does not mutate
  until confirmed.
- `body_patch` changes only the declared locale body; `image_only` regenerates
  cover without rewriting body markdown.
- Cancel revision restores `AWAITING_CLIENT_APPROVAL` on the prior version.
- Schema-invalid revision plans fail as `provider_final` (not opaque retry loops).

### Category

- Exact existing category.
- Case/whitespace normalization.
- Likely typo confirmed by client.
- New category creates preview but requires admin publication approval.
- Admin rejection **cancels** the request and notifies the client (ADR-0050);
  it does not return to client revision.
- Admin Telegram approve/reject buttons for `AWAITING_ADMIN_APPROVAL` (ADR-0050).

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
