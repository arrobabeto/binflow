# Security model

## Security objective

Allow authorized users to perform narrowly scoped website operations without turning natural language, a model, Telegram or a compromised integration into general production access.

## Trust boundaries

Untrusted:

- Telegram messages, files, callbacks and visible profile data.
- Repository, CMS, website and external research content.
- Model output, rationale and proposed tool arguments.
- External webhook delivery order and duplication.
- User-provided URLs and document metadata.

Trusted only after verification:

- Dashboard sessions with completed TOTP.
- Bot integration resolved from stored token/secret association.
- GitHub App installation token scoped to the configured repository and downscoped to the current operation.
- Vercel events validated and correlated to the configured project.
- Data returned by adapters after schema and ownership checks.

Never passed to the model:

- Secret values, decryption keys, sessions or provider credentials.
- Generic database, filesystem, shell, merge or publication operations.
- Other tenant/project data.

## Threats and controls

| Threat                           | Required controls                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Unauthorized Telegram user       | One-time pairing, identity allowlist, tenant-scoped bot, RBAC                                                       |
| Forged/replayed webhook          | HTTPS, provider signature/secret, delivery dedupe, expiration                                                       |
| Callback replay                  | Opaque server action ID, user/project/version binding, expiration, idempotency                                      |
| Prompt injection                 | Treat external text as data, bounded capability context, output validation outside model                            |
| LLM proposes forbidden operation | Tool registry allowlist and deterministic policy rejection                                                          |
| Cross-tenant disclosure          | RLS, scoped repositories, tenant artifact prefixes, isolation tests                                                 |
| Secret leakage                   | Envelope encryption, redaction, no secrets in queue/checkpoint/log/model contexts                                   |
| Local KEK disclosure             | Generate outside repository, regular-file and `0600` validation, no key output or database copy                     |
| Excess GitHub App authority      | Single-repository installation, per-operation token downscoping, separate admin authorization and permission audits |
| Approval of stale content        | Bind approval to request version, SHA and deployment/version                                                        |
| Concurrent manual change         | Fresh source read, expected version and conflict stop                                                               |
| Duplicate publication            | Idempotency keys, graph checkpoints, merge/publication reconciliation                                               |
| Malicious attachment             | MIME sniffing, size limits, malware scan, safe parser, no macro execution                                           |
| SSRF                             | URL parser, DNS/IP validation, protocol/port rules, redirect revalidation, egress policy                            |
| Public confidential preview      | Vercel protection/share link policy and revocation                                                                  |
| Compromised worker               | Non-root container, minimal mounted secrets, no Docker socket, scoped egress                                        |
| Model cost abuse                 | Per-tenant budgets, call/token caps, rate limits and admin alerts                                                   |

## Authentication and authorization

### Dashboard

- Email/password account created through an explicit bootstrap process.
- TOTP setup and verification are mandatory before managing integrations, secrets or approvals.
- Backup codes are shown once and stored protected.
- Cookies are secure, HTTP-only, same-site and short-lived with server-side revocation.
- Sensitive actions require a fresh/re-authenticated session.
- Runtime HTTP sign-up and password-reset email are disabled. A single owner is
  created by the interactive, advisory-lock-serialized local bootstrap command.
- Password bounds are 12–128 characters. Sessions expire after 12 hours, refresh
  at most hourly, use no cookie cache and are fresh for five minutes.
- TOTP is the only online factor and trusted-device bypass is rejected. Backup
  codes are single-use and disclosed only during enrollment/regeneration.
- Completing initial TOTP enrollment revokes all earlier password-only sessions
  before the verified session is issued.
- Auth rate-limit counters are PostgreSQL-backed and the application trusts
  forwarded client IP metadata only at the configured Caddy boundary.
- The Better Auth secret is independent from the provider-credential KEK and is
  supplied only through a direct secret value or `_FILE` indirection.

### Telegram

- Updates are authorized by verified bot identity plus numeric channel
  identity, never username or message text.
- Pairing/action plaintext tokens are return-once values; persistence contains
  SHA-256 hashes only and fixed-length digests are compared in constant time.
- Replay keys include bot ID, isolating identical update/user IDs from distinct
  bots.
- Cross-tenant outbox discovery and verified bot startup use the explicit
  `platform_system` database scope. It accepts only a code-owned operation name,
  is unavailable to HTTP request handlers and must emit business audit events
  for every mutation it dispatches.

- Tenant is resolved from the registered bot integration, never message text.
- User is resolved from Telegram numeric user ID, never username/display name.
- Pairing token is random, hashed, single-use, bot/user/tenant scoped and expires in 24 hours.
- The first MVP accepts direct messages only.

### Authorization

Every command checks user, tenant, project, role, capability, project binding, request state and effective policy. Administrator cross-tenant access uses a distinct audited authorization path.

Business repositories require a transaction-scoped tenant, authenticated
platform owner or named system operation. Runtime services connect with a
non-owner PostgreSQL role without `BYPASSRLS`; migration ownership is not
available to API, dashboard or worker requests. Platform-owner scope records
actor and reason in audit.

Dashboard business mutations are same-origin, require an authenticated session,
validate `Origin`/`Content-Type`, use idempotency keys and enforce optimistic
resource versions. Authentication cookies alone never select a tenant or grant
a capability.

Enrollment activation is fail-closed over named, versioned and dependency-bound
validation evidence. Credential health cannot substitute for Telegram test
delivery, reversible repository/deployment probes, manifest/catalog checks or
pairing. Pairing secrets are random, hash-only at rest, scoped and returned
once. Pairing idempotency persists only a redacted receipt; replay cannot recover
the plaintext token.

Project manifests are produced only by the code-owned profile validator.
Administrator input may narrow locales, paths and budgets but cannot supply
provider resource identities, executors, capability definitions or additional
paths. Active manifests and their locale/budget snapshots are immutable; model
output never enters this control-plane configuration boundary.

Capability definitions are also code-owned. The browser and model receive only
the active project's allowlisted catalog projection; neither can supply an
executor ID, permission set, schema, version or access level. The project
binding is an immutable manifest-scoped snapshot and deterministic policy adds
admin approval for a new category without widening the capability.

## Secrets

- 256-bit random KEK generated by the Phase 0 CLI outside the repository with file mode `0600` in local mode and provided as an external Docker secret in production.
- Random DEK per credential.
- AES-256-GCM for secret and DEK wrapping.
- AAD contains tenant ID, credential ID, provider and key version.
- PostgreSQL stores ciphertext, nonce, auth tag, wrapped DEK and secret metadata only.
- KEK versions permit DEK rewrap without decrypting all secrets into application memory at once.
- Secret values are immediately cleared from request/log objects where possible.
- No secret value is returned after creation; UI displays alias, state and masked suffix.
- Credential entry is an interactive, non-echoed CLI/dashboard operation; command arguments and committed environment files are forbidden. The GitHub App PEM may be imported only from an interactively selected regular `0600` file outside the repository, with a bounded read size.
- KEK and decrypted credential material never enter model context, queue jobs, workflow checkpoints or provider-neutral domain values.
- Credential ownership is explicit: platform credentials use null tenant/project foreign keys and the reserved AAD tenant component `platform`; tenant/project credentials use the real tenant ID. `platform` is not a synthetic tenant and is accessible only through the audited platform-owner path.
- Safe provider configuration is stored separately from the encrypted bundle. Secret parsing and plaintext lifetime remain inside the adapter and buffers are cleared in `finally` paths where possible.
- Verification is externally read-only and persists only allowlisted evidence. Provider bodies, webhook URLs, native error messages, authorization headers, JWTs and ephemeral provider tokens are never stored or printed.
- Only the Fastify API, worker and maintenance roles receive the runtime KEK;
  the Nuxt dashboard container does not. Docker runtime mounts may expose secret
  files as read-only `0400`, `0440` or `0444`; writable runtime secret files are
  rejected. Local host key files remain exact `0600`.
- Dashboard candidate idempotency binds secret input with an HMAC under the KEK.
  Plaintext and unkeyed secret hashes never enter idempotency, audit or outbox.

## Prompt and model safety

- Prompts clearly delimit system rules from untrusted content.
- The model sees only schemas and capabilities available to the current request.
- Structured output is validated with shared schemas.
- Refusal, malformed output and policy violations are explicit domain outcomes.
- Research URLs use a controlled fetch/search tool and claims keep evidence references.
- A generated rationale is an auditable summary, not private chain-of-thought.
- Stable privacy-preserving safety identifiers are sent when supported.

## Attachments

First-MVP accepted formats:

- Documents: PDF, DOCX, TXT and Markdown.
- Images: JPEG, PNG, WebP and AVIF.

Default limits:

- Maximum five attachments per request.
- Maximum 10 MiB per document and 15 MiB per image.
- Configurable lower per-project limits.

Parsers run without macros, network access or executable extraction. Unsupported, encrypted, corrupt or image-only documents that cannot be safely extracted are rejected with a user-actionable message.

Originals are deleted after terminal completion/cancellation. Derived published assets and hashes follow project/audit retention.

## GitHub and deployment

- GitHub App, never a personal long-lived PAT.
- By explicit owner decision, the first app's registration ceiling is Administration read/write, Metadata read, Contents read/write, Pull requests read/write, Checks read, Commit statuses read, Deployments read and Workflows read/write.
- The app is installed only on `arrobabeto/webbin`; Actions, Actions secrets and Dependabot secrets are not granted.
- Every installation token is limited to Webbin and downscoped per operation. Normal blog execution omits Administration and Workflows.
- The sole exception is ADR-0014's deterministic `installation_audit`: a metadata/read-only token may enumerate the selected installation repositories to prove the Webbin-only rule, then is revoked/discarded immediately. It has no content, administration or workflow write authority and is never model-visible.
- Administration or Workflows may be requested only by a deterministic, separately admin-authorized onboarding/configuration action; never by the model or a generated content request.
- Workflow/onboarding changes use a separately authorized PR and cannot be combined with generated content.
- Every request owns one branch and PR.
- No force push, shared mutable job branch or direct production-branch write.
- Preview must not receive unnecessary production secrets or trigger real forms/payments/email.

## Logging and audit redaction

Structured logs may contain identifiers, states, durations, provider and error classes. They must not contain:

- API/bot tokens, passwords, cookies, authorization headers or decrypted TOTP material.
- Complete prompt payloads or attachments by default.
- Shareable preview tokens.
- Private provider reasoning items in readable form.

Audit stores redacted structured inputs or hashes and references large artifacts through controlled storage.

## Security change requirements

Any trust-boundary, credential, auth, tenant, approval, tool or egress change must update this document, add security tests and create/supersede an ADR when the decision is durable.

The accepted exception and compensating controls for GitHub registration authority are governed by [ADR-0013](adr/0013-github-app-administrative-registration.md).
