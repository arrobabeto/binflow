# ADR-0014: Integration credential scope and candidate verification

- Status: Accepted
- Date: 2026-08-11
- Supersedes: ADR-0013 only for the administrative installation-audit token exception
- Superseded by: None

## Context

Phase 0 introduces real provider verification before the dashboard exists. The original CLI contract did not distinguish platform registration credentials from tenant/project credentials, did not separate public provider configuration from encrypted values and did not define how a failed rotation affects the last healthy credential.

The GitHub App private key authenticates the platform registration across installations; it is not a Webbin project secret. Telegram also has a platform-owned admin bot and tenant-owned client bots. Verification must establish identity without mutating repositories, webhook configuration or user-visible chats.

## Decision

Credentials have one immutable owner scope:

- `platform`: GitHub App registration and Telegram admin bot.
- `tenant`: OpenAI and Telegram client bot.
- `project`: Vercel and future project-specific provider credentials where required.

Platform credentials store null tenant/project foreign keys. Their encryption AAD uses the reserved literal `platform` as the tenant component; tenant/project credentials use the real tenant ID. The reserved literal is encryption context only and never creates a synthetic tenant.

Each credential separates non-secret configuration from the encrypted secret bundle. App IDs, client IDs, expected bot usernames and other safe registration identifiers are credential configuration. Repository coordinates, production branch and provider project IDs belong to the tenant/project `integration_connection`, including when the credential itself is platform-scoped. API keys, bot tokens, private keys, webhook secrets and access tokens remain inside the envelope. Secret values are resolved and parsed only inside the provider adapter.

`integration set` always creates an `unverified` candidate. A successful verification atomically activates that candidate and marks the prior active version for the same owner scope and kind as `superseded`. Activation serializes on the owner scope/kind and rejects a candidate older than the current active version, so out-of-order provider responses cannot roll back a rotation. A permanent authentication, authorization, policy or provider-contract failure marks the candidate `invalid`; a retryable network, rate-limit, timeout or provider outage leaves its prior state unchanged. A failed candidate never displaces the previous active version. Revocation remains explicit and idempotent.

Verification attempts are monotonic by their application-issued `checked_at`. A result older than the stored `tested_at` is discarded and audited without changing status, evidence or timestamps. Deterministic activation failures are normalized through the same redacted result contract so `verify --all` can continue; a concurrent revoke remains unavailable and is never rewritten as a provider failure.

Verification is read-only with respect to external customer systems:

- OpenAI authenticates and confirms visibility of the required Phase 0 model IDs through the model catalog. Workload-level structured-output, research, embedding and image probes are separate, explicitly invoked spikes.
- Telegram calls `getMe` and `getWebhookInfo`, validates the expected username and reports a polling/webhook conflict without deleting or configuring a webhook. Test-message delivery waits for onboarding/pairing to provide an authorized chat ID.
- GitHub authenticates the App, checks its identity and exact registration permission ceiling, discovers the expected installation and verifies Webbin identity/default branch. It creates no branch, commit, check, deployment or PR. The webhook secret remains pending until a signed delivery is observed.
- Vercel authenticates the user and reads the bound project, then verifies exact account/team ownership, GitHub organization/repository and production branch without creating or changing a deployment/project.

GitHub installation discovery needs visibility into every repository selected for that installation to prove the Webbin-only rule. One deterministic `installation_audit` operation may therefore mint a metadata/read-only installation token without repository downscoping, enumerate the installation repositories, assert that the set is exactly `arrobabeto/webbin`, and revoke/discard the token immediately. This narrowly supersedes ADR-0013's statement that every installation token is repository-downscoped. All normal operations remain repository-ID and permission downscoped; the model cannot request the audit operation.

GitHub App registration credentials are platform-scoped. The Webbin project stores a non-secret installation binding containing installation ID, repository ID, owner/name, production branch, permission snapshot/status and the credential reference. Vercel likewise stores project/team and Git binding data in its project connection. Installation tokens are ephemeral and never stored.

During Phase 0, the only internal project authorized to bind the external Webbin repository/project is tenant key `webbin` plus project key `webbin`. The binding is application policy, not operator-supplied provider configuration. A project-owned credential and its connection must use the exact same tenant/project pair, connection kind must equal credential kind, and one credential version has at most one connection in the first MVP.

Migration `0002` has one historical exception: pre-ADR GitHub rows remain `project`-scoped only as revoked, non-resolvable audit records. Every newly enrolled or resolvable GitHub App credential is platform-scoped.

Verification evidence is validated through a strict per-provider allowlist at the application-service boundary before persistence or output. It may contain provider object IDs, usernames, repository full name/default branch, permission hashes, model IDs, transport mode, timestamps and stable error categories. Extra or malformed fields reject the result and are never persisted or displayed. It never contains provider response bodies, authorization headers, webhook URLs, raw error messages, JWTs, installation tokens or secret values. `tested_at` records the latest attempt; stored evidence and `verified_at` always describe the latest successful attempt.

An active Telegram numeric bot ID is globally unique across admin/client roles and tenants. Activation serializes on that bot ID and the database enforces the same invariant, so one token cannot ambiguously resolve to multiple scopes. A newer credential version may preserve the same bot ID only while atomically replacing the active version of that exact owner scope and kind.

Integration connections enforce that `project_id` belongs to their `tenant_id` with both repository validation and a composite foreign key. Tenant RLS never trusts an independently supplied tenant/project pair.

## Consequences

- Rotation is safe: the current healthy credential survives a failed candidate.
- Out-of-order rotations cannot replace a newer active version, and a Telegram bot identity cannot be active in two scopes.
- Platform credentials no longer masquerade as project-owned secrets.
- Credential verification does not prove webhook delivery, Telegram send ability or full workload behavior; activation performs those later checks.
- The GitHub audit token has broader repository visibility than runtime tokens but no write permission, exists only for the explicit audit operation and is immediately revoked/discarded.
- Adding an externally mutating verification step requires a new decision and explicit authorization.

## Alternatives considered

- Encrypt every provider field together: rejected because safe configuration must be queryable without decrypting secrets.
- Replace the active credential as soon as a new value is entered: rejected because a typo would cause avoidable downtime.
- Treat the GitHub private key as Webbin-owned: rejected because the key authenticates the App registration, not one installation.
- Prove Telegram and GitHub access by sending a message or creating a test branch: rejected because credential verification must be safe and read-only.
- Trust a manually reported GitHub repository selection: rejected because ADR-0013 requires machine-verifiable Webbin-only installation scope.

## Verification

- Tests cover platform/tenant/project AAD isolation and forbid cross-scope resolution.
- Candidate success supersedes the prior active version atomically; concurrent/out-of-order success, permanent/transient failure and verify/revoke races follow the documented transitions.
- `verify --all` deterministically selects each current active credential plus the newest unverified candidate per owner scope/kind.
- Provider contract tests assert exact read-only calls, timeout/error mapping and redacted evidence.
- Application-service tests reject non-allowlisted evidence before database persistence or CLI output.
- Database tests reject cross-tenant/project connection bindings, unauthorized internal Webbin scopes and duplicate active Telegram bot identities while allowing same-binding bot rotation.
- GitHub tests assert the audit token has no write permission, is used only for installation enumeration and is revoked/discarded; normal operation mappings continue to omit Administration and Workflows.
- Secret scanning proves plaintext is absent from database metadata, events, logs, queues, stdout and stderr.
