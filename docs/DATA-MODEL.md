# Data model

## Modeling rules

- UUIDv7 identifiers for sortable business records; external provider IDs stored separately.
- UTC timestamps in storage; project timezone only affects presentation/publication semantics.
- All tenant-owned rows contain non-null `tenant_id` and use RLS where practical.
- Important state changes are events in addition to current-state columns.
- Secrets are references, never plaintext fields.
- Large bodies live in the artifact store with digest and ownership metadata.
- Mutable aggregates use optimistic concurrency versions.
- Soft deletion preserves audit unless a retention policy requires physical deletion.

## Identity and tenancy

### `tenants`

Client security boundary: key, display name, status, timezone and timestamps.

### `users`

Person record independent from channel identity. Better Auth owns credential/session tables.

### `memberships`

Tenant/project role and status. First MVP permits one client membership per enrollment plus platform owners.

### `channel_identities`

Provider, external numeric user ID, user ID, tenant ID, verification state and last-seen timestamp.

### `telegram_bot_integrations`

Role (`admin` or `client`), tenant, bot username, secret references, webhook/polling state and health.

### `pairing_tokens`

Hashed token, tenant/user/bot binding, expiry, consumed timestamp and creator.

## Project configuration

### `projects`

Tenant, key, display name, profile, lifecycle state, domains, active manifest version and optimistic version.

### `client_enrollments`

Wizard state:

```text
DRAFT → CONFIGURING → VALIDATING → VALIDATION_FAILED
      → READY_FOR_PAIRING → PAIRING_PENDING → ACTIVE
```

Alternate states: `REVALIDATION_REQUIRED`, `SUSPENDED`, `ARCHIVED`.

### `project_manifest_versions`

Immutable JSON contract, version, validation state, creator, timestamps and superseded link.

### `capability_definitions` and `project_capability_bindings`

Global code-owned capability versions and project-specific access/approval bindings.

### `rule_set_versions`, `node_config_versions`, `workflow_definitions`

Immutable editorial rules, provider/model/prompt configs and graph versions.

### `project_locales`

Conversation locale, content locales, required locales and translation policy derived into the active manifest.

## Integrations and secrets

### `integration_connections`

Provider/type, tenant/project binding, credential reference, external resource IDs, status, latest test/success timestamps, allowlisted verification evidence and configuration excluding secrets. A platform GitHub App credential and a project-owned Vercel credential are linked to the project through this table. A composite foreign key guarantees that the project belongs to the stored tenant. Phase 0 permits at most one connection per credential version; project-owned credential scope must equal connection scope.

### `secret_references`

Encrypted secret envelope and lifecycle state. Each credential version stores ciphertext, nonce and authentication tag for the secret; one random DEK wrapped with AES-256-GCM; wrapping nonce/tag; AAD scope fields; KEK version; and redacted metadata. It never stores the KEK or plaintext.

### `provider_credentials`

Owner scope (`platform`, `tenant` or `project`), provider, non-secret configuration, normalized external identity when applicable, secret reference, masked suffix, version, status and tested/verified/used/revoked timestamps. Statuses are `unverified`, `active`, `invalid`, `superseded` and `revoked`. At most one version per owner scope/kind is active, and one Telegram bot ID can be active globally. First MVP requires an active OpenAI credential per tenant.

### `credential_events`

Creation, test, activation, supersession, use, revoke and failure audit without secret values. Verification metadata is allowlisted provider evidence plus stable outcome/error category, never a native response body.

## Conversations and requests

### `conversations` and `messages`

Normalized channel/thread metadata. Message bodies may have shorter retention than audit; attachments are referenced.

### `requests`

Stable user intention, capability, current state/version, tenant/project/user and terminal result.

### `request_versions`

Immutable interpreted input, confirmed plan, frozen versions, base source revision, effective policy and superseded relationship.

### `clarifications` and `plans`

Question/answer and structured plan history with confirmation timestamps.

## Workflow execution

### `graph_runs`

Request version, graph version, thread/checkpoint identifiers, status, start/end and current node.

### `node_runs`

Node version, input/output artifact references, attempt, timings, model/tool association and result/error.

### LangGraph checkpoint tables

Owned by the supported checkpointer implementation. Business tables reference but do not duplicate checkpoint content.

### `outbox_events` and `processed_events`

Transactional event delivery and consumer/provider idempotency.

## Content and artifacts

### `artifacts`

Tenant/project/request ownership, kind, storage key, MIME, bytes, SHA-256, lifecycle, retention deadline and provenance.

### `content_catalog_items`

Source, source ID/revision, canonical group, locale, slug, title, normalized title, category, summary, keywords, content hash, embedding reference, status and timestamps.

Statuses: `published`, `source_draft`, `orchestrator_draft`, `deleted`.

### `content_catalog_syncs`, `similarity_checks`, `candidate_matches`

Sync cursor/revision, counts, classification inputs, candidates, scores and final structured decision.

## Repository, deployment and approval

### `repo_changes`

Base/head SHA, branch, allowed file list, before/after hashes and PR association.

### `pull_requests`

Provider ID/URL, base/head, state, merge commit and timestamps.

### `checks` and `deployments`

Provider identity, commit association, environment, immutable/branch URLs, state and verification result.

### `approvals`

Request/version/artifact binding, required role, approver, decision, expiry and idempotency/action metadata.

### `publication_attempts`

Precondition snapshot, external action identifiers, result and production verification.

## AI, usage and audit

### `model_calls`

Provider/model/config versions, redacted input hash, structured output reference, token counts, latency, provider request ID, cost and error.

### `generated_rationales`

Explicit rationale schema linked to model call and evidence references.

### `usage_records` and `pricing_snapshots`

Tenant/project/request/capability/node/provider/model dimensions and reported/calculated/estimated cost quality.

### `audit_events`

Append-only actor, action, object, tenant/project/request identifiers, redacted metadata, correlation IDs and timestamp.

## Retention defaults

| Data                            | First-MVP retention                                            |
| ------------------------------- | -------------------------------------------------------------- |
| Original Telegram attachment    | Until request completes or is cancelled                        |
| Generated/published artifact    | While referenced by source/audit; subject to project policy    |
| Request/audit/approval metadata | Indefinite during private MVP                                  |
| Structured operational logs     | 30 days locally unless overridden                              |
| Pairing token                   | Record retained; secret hash unusable after expiry/consumption |
| Revoked credential ciphertext   | Removed after revocation audit and configured recovery window  |

Retention policy changes require privacy, operations and security documentation updates.
