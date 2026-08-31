# Operations

## Environments

### Local MVP

- PostgreSQL, Redis, MinIO and ClamAV through Docker Compose.
- ClamAV uses the official Debian-based `clamav/clamav-debian:1.4.6` image so
  the same Compose definition runs natively on Apple Silicon (`linux/arm64`)
  and the production VPS target (`linux/amd64`); do not force an emulated
  platform in Compose.
- API, dashboard, worker, maintenance and one-shot CLI services are packaged in Docker from Phase 0; supervised host processes remain an optional development convenience.
- Local and production profiles build the same versioned first-party images.
- Telegram uses polling.
- `BINFLOW_LIVE_EXECUTION_ENABLED` defaults to `false`. Enabling it authorizes
  the worker to construct mutation adapters but does not bypass manifest,
  budget, preview or approval policy.
- Before webhook cutover, pair and test the admin destination, configure
  distinct admin/client webhook secrets, verify readiness, then stop polling
  before registering webhook URLs. Never run polling and webhook delivery
  together.
- GitHub/Vercel state may be reconciled by API polling.
- Real external mutations require explicit test/pilot configuration, never production secrets in committed files.
- Schema migrations use the database owner connection. API, worker, dashboard
  auth and maintenance use a distinct non-owner runtime role so RLS is effective.
- Dashboard readiness requests `/login`, which also proves that the auth secret
  and PostgreSQL-backed session runtime can initialize; Caddy waits for this
  health check in production.

Start durable dependencies with `docker compose -f infra/compose/local.yml up -d postgres redis minio clamav`, then apply migrations with `pnpm db:migrate`. Host `pnpm dev` needs those ports on localhost; it does not start PostgreSQL or Redis by itself. The same Compose file can build the current API, dashboard, worker and maintenance images; the CLI intentionally runs in the trusted host terminal so interactive secret input never traverses Compose configuration.

After portfolio cover encoding changes (JPEG → AVIF), force-bump the active
Webbin manifest path allowlist so `render_artifacts` accepts
`public/images/projects/*.avif`:

`pnpm --filter @binflow/tools exec tsx scripts/refresh-webbin-manifest-avif-paths.ts`

After Astro Orbitype blog collection path changes, force-bump Bistro:

`pnpm --filter @binflow/tools exec tsx scripts/refresh-bistro-manifest-blog-paths.ts`

### New tool scaffolding (ADR-0039)

Author a validated brief under `packages/tools/briefs/<id>.brief.yaml`, then:

```bash
pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/<id>.brief.yaml --dry-run
pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/<id>.brief.yaml
```

Paste stdout snippets into contracts, policies, and `capability-runtimes.ts`. Implement
executor/runtime before enabling bindings. Destructive tools remain design-only until
ADR-0040 platform gaps close.

Example dry-run (no catalog registration):

`pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/delete_project_astro.brief.yaml --dry-run`

Enable `delete_project_astro@2` on an existing Webbin enrollment after migration
`0023`:

`pnpm --filter @binflow/tools exec tsx scripts/add-webbin-delete-project-binding.ts`

### Delete blog stuck requests

If a client re-requests delete for an already-removed article and a request
lands in `REVALIDATING` or another non-terminal state, cancel or mark failed in
the dashboard. There is no automatic heal job in MVP.

If delete-blog **merged** but `verify_production` failed while the article files
are already gone, confirm production routes return 404 for the deleted slug. When
they do, reset the request to `APPROVED_FOR_PUBLISH` and re-enqueue
`workflow.resume` with `reason: publish`, or mark `COMPLETED` manually if
tombstone and client notification already ran.

Post-deletion HTTP redirects are not managed by Binflow until the client repo
supports Vercel-native redirects (ADR-0041). Search Console cleanup for removed
URLs is handled in the client repository.

Do not re-run full delete execute for slugs already removed from the repository.

### Multiple GitHub Apps (Webbin + Bistro)

After migration `0026`, distinct GitHub App registrations (`configuration.appId`)
may both be `active` at platform scope. The worker must resolve installation IDs
through the project's active `integration_connections` row. If a client draft
lands in the wrong repository, check that the project's GitHub connection is
`active` and that only one live worker holds Telegram polling locks
(`binflow:telegram:polling:*` in Redis).

`DATABASE_URL` is the runtime application connection. `BINFLOW_MIGRATION_DATABASE_URL`
or its `_FILE` variant is the schema-owner connection used only by migration and
release commands. Production must not mount the migration credential into API,
dashboard, worker or maintenance containers.

Fresh local PostgreSQL volumes create `binflow_app` through
`infra/postgres/local-init.sql`. For an existing local volume, recreate only the
PostgreSQL container to mount the script, then apply it idempotently:

```text
docker compose -f infra/compose/local.yml up -d --force-recreate postgres
docker compose -f infra/compose/local.yml exec -T postgres psql -v ON_ERROR_STOP=1 -U binflow -d binflow -f /docker-entrypoint-initdb.d/001-runtime-role.sql
```

This does not recreate or delete the PostgreSQL data volume.

Migration execution serializes on the PostgreSQL advisory lock named
`binflow_schema_migrations`. A second migrator waits for the first and then
reconciles the journal; operators must not bypass this runner with concurrent
manual SQL application.

### Production-ready profile

- Ubuntu LTS VPS with Docker Engine and Compose.
- Caddy terminates TLS and routes dashboard/API/webhooks.
- Services run as non-root with health checks and resource limits.
- PostgreSQL, Redis and artifacts use separate persistent volumes.
- Docker socket is never mounted.
- Telegram/GitHub/Vercel use authenticated HTTPS webhooks.

First production target should provide at least 2–4 vCPU, 8 GiB RAM and 100 GiB persistent storage. Provider selection is operational, not an application coupling.

## Configuration classes

### Non-secret

- Public base URL and environment.
- Database/Redis/object-store endpoints without credentials.
- Log level, retention, rate and worker concurrency defaults.
- Allowed callback domains and provider feature flags.

Dashboard sessions use a rolling 30-minute inactivity limit. Changing this
policy requires an ADR and coordinated dashboard/API restart; sessions whose
persisted last activity already exceeds the new limit are rejected immediately.

### Secret

- Database, Redis and object-store credentials.
- Better Auth secret and bootstrap material.
- SecretsProvider KEK.
- Telegram, OpenAI, GitHub App, Vercel, Orbitype API key and future integration credentials.

Production secrets use Docker secrets or a future managed secret provider. They never appear in Compose files, images, Git or documentation.

### Local Phase 0 secret bootstrap

Before storing an integration, run `pnpm binflow secret init` from an interactive terminal. It creates a random 256-bit KEK at the configured host location outside the repository, sets mode `0600` and prints only the resulting reference. Binflow refuses to initialize or start secret-dependent operations when the key path is inside the repository, is not a regular file, has broader permissions or does not contain exactly the supported key material.

Local Compose mounts that `0600` host key read-only at
`/run/secrets/binflow_kek`. Docker Desktop preserves the source permission bits
instead of synthesizing `0444`; the runtime therefore verifies the bind mount by
requiring a non-mutating read/write open probe to fail with `EROFS`. Any
successfully writable mount remains a startup failure.

Until the Phase 1 onboarding dashboard exists, initialize the pilot ownership scope with `pnpm binflow scope init --tenant webbin --project webbin`. This creates only draft tenant/project records and is idempotent; activation still requires the documented onboarding validations.

Any Phase 0 credential command that selects a project must pass both `--tenant`
and `--project`; project keys are tenant-local and are never resolved globally.

Use the Phase 0 credential CLI documented in [public contracts](CONTRACTS.md#phase-0-credential-cli). Values are entered only through non-echoed prompts. The GitHub App PEM is imported from a path selected inside the interactive flow after the operator places it outside the repository and restricts it with `chmod 600`. Shell arguments, committed `.env` files and Compose YAML are not credential entry mechanisms.

After `integration set`, run `integration verify <credential-id>` for the candidate or `integration verify --all` for deterministic health/candidate reconciliation. Verification is safe to retry and externally read-only. A failed candidate does not displace the last active version; retryable failures preserve status. Operators may revoke an invalid candidate after diagnosis. No verification command deletes Telegram webhooks, sends Telegram messages or changes Webbin.

Before applying the credential migrations, take and restore-test a database
backup, inventory every active provider binding, and confirm that replacement
OpenAI, Telegram, GitHub App and Vercel credentials are available for immediate
interactive re-enrollment. Do not start the migration window without those
inputs because legacy credentials intentionally become unavailable.

Migration `0002` introduces separated configuration and new ownership semantics.
Legacy encrypted payloads cannot be rewritten safely in SQL because the KEK is
external and their JSON shapes differ from the new strict bundles. The migration
therefore preserves every legacy row for audit, marks it and its secret reference
revoked, emits a deterministic migration revocation event, and keeps a legacy
GitHub row project-scoped. After migration, the
operator re-enters every required provider credential through `integration set`
and verifies the new candidate. No legacy ciphertext becomes active
automatically. Rollback uses the prior application/database backup; the
enum/scope migration is not destructively reversed in place.

Migration `0003` additively stores redacted verification evidence on integration
connections. Considered alone, older application images ignore that column.
The complete release also includes the write-incompatible ownership change from
`0002`, so rollback of the release always restores the pre-migration application
and verified database backup together.

Migration `0004` additively stores normalized external identities and latest
successful-verification timestamps, prevents one Telegram bot from being active
in multiple bindings, and replaces the independent project foreign key with the
tenant/project composite binding. Rollback keeps these columns and constraints;
restore the prior database backup only when reverting the full credential model.

Migration `0005` adds composite tenant/project foreign keys to credentials and
secret references and limits Phase 0 to one project connection per credential
version. Apply it after `0004`; rollback keeps the constraints unless the full
credential-model backup is restored.

Migration `0006` adds the administrative operation, idempotency, audit, outbox
and processed-event foundation, forces RLS on tenant-owned tables and grants
only runtime DML to the pre-provisioned `binflow_app` role. Migration `0007`
makes audit events append-only. Both are additive; rollback keeps the tables and
stops new writers before reverting application images. Do not remove audit or
idempotency history during rollback.

Production supplies the KEK as a Docker secret. Database records contain one random DEK and AES-256-GCM encrypted envelope per credential version; the KEK itself is never stored in PostgreSQL.

### Platform-owner authentication bootstrap

Generate a separate Better Auth secret outside the repository before starting
the dashboard or API. Local development uses a regular `0600` file. Compose
services receive that path through `BINFLOW_AUTH_SECRET_FILE`; host `pnpm dev`
loads the same default file (`$XDG_CONFIG_HOME/binflow/auth-secret-v1.key`, or
`~/.config/binflow/auth-secret-v1.key`) when neither `BINFLOW_AUTH_SECRET` nor
`BINFLOW_AUTH_SECRET_FILE` is set. Production mounts the secret as
`/run/secrets/auth_secret`. Do not reuse the SecretsProvider KEK.

```text
pnpm binflow auth-secret init
```

After auth migrations are applied, create the sole platform owner from an
interactive terminal:

```text
pnpm binflow admin bootstrap --email owner@example.com --name "Platform owner"
```

The password is prompted and confirmed without echo. Bootstrap takes the
`binflow_admin_bootstrap` PostgreSQL advisory lock and fails closed if any auth
user already exists. It does not enroll TOTP. Start the dashboard, sign in and
complete `/security`; store the displayed backup codes before leaving.

Runtime sign-up and password-reset email remain disabled. Ordinary recovery is
an unused backup code. Break-glass recovery requires local database-owner and
auth-secret access, a current backup, session revocation and an audit entry; it
must never delete the owner or create a replacement account. Detailed recovery
commands are added with the recovery implementation and are not inferred with
manual SQL.

Migration `0008` adds Better Auth user, session, account, verification,
two-factor and rate-limit tables, the single-owner invariant and the trigger
that revokes pre-enrollment sessions on first TOTP activation. It is additive
but contains security state. Rollback stops dashboard/API auth traffic, restores
the pre-release database backup and prior images together; never drop live auth
tables merely to downgrade an application container.

Migration `0009` adds the resumable enrollment aggregate, immutable validation
attempts and hash-only pairing-token records with tenant/project RLS. It is
additive. Rollback stops enrollment writers and keeps history; restoring a prior
database backup is required if the release itself must be reversed.

Migration `0010` adds the credential resource revision used by dashboard
optimistic concurrency. It backfills revision `1` and is additive. The API now
requires the existing SecretsProvider KEK mount (`BINFLOW_KEK_FILE`) while the
dashboard must not receive that mount. Rollback stops credential writers and
restores the coordinated pre-release application/database backup if required.

Migration `0011` adds immutable project manifest, locale and budget snapshots
plus the nullable active-manifest version on projects. It is additive. Rollback
stops enrollment validation writers and preserves manifest history; an older
application ignores the new tables and nullable project column, but a full
release rollback still uses the coordinated pre-release backup procedure.

Migration `0012` adds the global capability-definition projection and immutable
project/manifest capability bindings. It seeds only `create_blog_draft@1` and is
additive. Rollback stops enrollment validation writers and preserves binding
history; restore the coordinated pre-release backup for a full release revert.

## Health

Migration `0013` adds channel identities and the durable request kernel. Stop
polling/webhook ingress and workers before applying it. Existing unscoped
pairing tokens are revoked; generate a new link afterward. Rollback requires the
pre-migration database backup and previous application images.

Migration `0014` adds catalog, artifact, repository, deployment, approval,
model-call and usage records. Stop workers before applying it. Rollback requires
the coordinated pre-release database backup; do not drop historical workflow
or provider identifiers manually.

Migration `0015` adds the platform admin pairing target, hash-only pairing
challenges and service heartbeats. It is additive. Stop admin-bot ingress and
workers before a coordinated rollback; preserve pairing and notification audit
history.

Migration `0016` adds tenant-isolated similarity decisions and ranked candidate
evidence. It is additive and forces RLS for the runtime role. Stop workers while
applying it; a full rollback restores the coordinated pre-release application
and database backup rather than deleting similarity history manually.

### Live blog execution switch

Keep `BINFLOW_LIVE_EXECUTION_ENABLED=false` while testing enrollment and the
fake-provider E2E suite. Set it to `true` only after provider verification,
artifact storage health and an operator review of the active Webbin manifest.
On the host, `pnpm run dev` leaves the switch off (confirmed plans stay
`QUEUED` with a pending `workflow.resume_requested` outbox row). Use
`pnpm run dev:live` when you intentionally want OpenAI/GitHub/Vercel mutation
after plan confirmation.
Turning it back to `false` immediately prevents new OpenAI/GitHub/Vercel
mutations. Pending workflow outbox records remain durable and undispatched
until the switch is enabled again; existing branches and PRs remain recorded
for reconciliation. Dispatched jobs retry retryable provider/internal failures
up to four attempts with exponential backoff, while deterministic policy,
authorization, validation and budget failures stop immediately. A `FAILED_FINAL`
publication that still lacks a production deployment is re-queued after the
worker starts so an already-merged GitHub PR can finish production verification.
Host `pnpm dev` and the Compose worker must not poll the same Telegram
bot at the same time. The worker now enforces this with a Redis polling lock
per bot: the holder long-polls ingress; any other instance starts in
**send-only** mode and can still deliver outbound notices without calling
`getUpdates`. When the lock holder exits, the send-only instance promotes
itself to polling on the next heartbeat (no manual restart). Keep Docker
dependencies (`postgres`, `redis`,
`minio`, `clamav`) running under Compose, but run **one** polling worker only:
either the Compose `worker` service **or** the host `@binflow/worker`
started by `pnpm dev`, never both. With `pnpm run dev` already polling,
stop the Compose poller with
`docker compose -f infra/compose/local.yml stop worker`. A second
`getUpdates` client produces Telegram
`Conflict: terminated by other getUpdates request` and drops ingress
until only one poller remains.

The local worker also reconciles Telegram runtimes on the heartbeat
interval: newly verified `telegram-client` (or admin) credentials start
polling automatically so enrollment pairing can activate without bouncing
the worker. Running two host workers (for example `pnpm dev` plus a second
`apps/worker` `pnpm dev`) still causes the same Telegram conflict; stop the
extra process.

### Notification dispatch

The worker drains two notification event types on the same schedule:
`admin.notification_requested` to the paired platform-owner chat and
`client.notification_requested` to the requesting client's conversation. Both
use bounded exponential backoff and mark an event `failed` after ten attempts.
Before Telegram delivery, the worker atomically leases each pending outbox row
(`available_at` lease) so concurrent workers (host + Compose, or send-only
replicas) cannot deliver the same notice more than once. Delivery is independent
of workflow state, so a stopped worker delays notices without losing or
reverting the transitions that produced them.

A client notice needs the client bot runtime, not the admin runtime. When the
client bot is unpaired or its runtime is missing, the event stays `pending` and
retries; it is never delivered to the admin chat as a fallback. Cancellations
performed from the dashboard while the worker is stopped are therefore announced
to the client once the worker returns.

### Webbin preview Deployment Protection

Telegram preview buttons open the unique Vercel deployment hostname. If the
Webbin Vercel project has Standard Protection / Vercel Authentication enabled
for Preview, those URLs prompt for a Vercel login and the client cannot review
the article.

Binflow does not mint shareable preview secrets. To let the client open the
preview without a Vercel account:

1. Open [Vercel](https://vercel.com/) as the team that owns Webbin
   (`arrobabetos-projects` in the current pilot).
2. Select the **webbin** project (not the Binflow dashboard).
3. Go to **Settings → Deployment Protection**.
4. Disable **Standard Protection** / **Vercel Authentication** for **Preview**
   deployments. Leave Production protected unless you intentionally want the
   live site public without Vercel auth (the custom production domain is
   already the public site).
5. Save, then open a current `*.vercel.app` preview URL in a private/incognito
   window with no Vercel session. The article should load.

Publication-complete Telegram messages use the enrolled production origin
(ADR-0048; Webbin `https://webbin.com.mx`), not the unique production deployment
hostname.

Re-enable Preview protection after the review if you do not want later preview
URLs to stay world-readable. Changing this setting does not alter Git, the
Binflow manifest `protectionMode`, or production evidence URLs.

Endpoints:

- Liveness: process event loop is responsive.
- Readiness: required database connection and migrations are healthy; API can refuse mutation readiness while serving diagnostics.
- Dependency detail is admin-authenticated and redacted.

The Operations dashboard surfaces PostgreSQL, Redis, worker heartbeat, object
storage and required integration readiness.

For local admin-bot pairing, create the one-time link from a non-idle,
TOTP-verified session, open the current link and send the generated `/start
<token>` command. A successful bot reply is the completion signal; a typing
indicator alone is not. Refresh the target projection afterward. If the link is
denied, create a new link only after confirming the worker is healthy and the
admin polling runtime is active; older unconsumed links are revoked when a new
one is issued.

## Backups

Production phase:

- Daily encrypted `pg_dump` stored outside the VPS.
- Artifact/configuration backup consistent with database references.
- Suggested retention: 7 daily, 4 weekly and 3 monthly backups.
- Provider snapshot is supplemental, never the only backup.
- Quarterly restore drill initially; increase after usage/criticality review.

Restore procedure must validate schema version, tenant counts, active requests, checkpoint readability, artifact references and secret decryption before reopening webhooks.

## Observability

### Correlation identifiers

Logs and traces carry applicable values:

```text
request_id
request_version_id
job_id
graph_run_id
node_run_id
model_call_id
trace_id
tenant_id
project_id
integration
```

### Metrics

- Requests and graph runs by state.
- Time to plan, preview, approval and production.
- Node duration, error and retry rates.
- Queue depth and worker heartbeat.
- Build/preview/production failure rates.
- Model calls, tokens and cost by tenant/project/capability/node/model.
- Revisions, approval age and stale requests.
- Integration health and webhook reconciliation lag.

### Alerts

- Worker or maintenance heartbeat missing.
- Queue not progressing.
- PostgreSQL backup or artifact cleanup overdue.
- GitHub/Vercel/OpenAI credential invalid/revoked.
- Preview/production deployment failed.
- Daily budget or retry threshold exceeded.
- Secret decryption or tenant-isolation control failure.

## Deployment

1. Build immutable, version-tagged images in CI using the same Dockerfiles exercised by local Compose.
2. Run migrations as a separate, observable release step.
3. Deploy API/dashboard/workers with compatible schema.
4. Verify health and run smoke tests.
5. Enable webhook delivery only after readiness.
6. Record deployment version and operational change in documentation/changelog.

The migration step uses the schema-owner credential; all application containers
are smoke-tested with the RLS-constrained runtime credential.
Production Compose exposes the one-shot `migrate` service only through the
`release` profile. Run it before application rollout with
`docker compose --profile release run --rm migrate`; the schema-owner secret is
mounted only in that container.

Do not use floating `latest` tags in production.

## Incident handling

Priorities:

1. Stop unsafe mutations by suspending affected project/integration or workers.
2. Preserve logs, audit, provider IDs and current checkpoints.
3. Revoke/rotate compromised credentials.
4. Determine whether external side effects occurred before retrying.
5. Communicate affected requests and recovery status.
6. Restore service and add a regression/failure drill.
7. Update security/operations documentation and incident ADR when assumptions change.

## Rollback

### Binflow application

Roll back application images only when database migrations remain backward compatible. Destructive schema rollback is never automatic.

### Repo-backed publication

Use a new revert PR to realign Git and production. Vercel rollback may restore service temporarily but does not replace the Git revert.

### Workflow recovery

Resume from durable checkpoint after verifying whether the external operation already completed. Do not restart a request from the beginning when a node can be reconciled.

## Retention maintenance

Maintenance jobs delete original request attachments at completion/cancellation, expired pairing/action tokens and orphaned temporary artifacts. Each deletion is idempotent and audited without retaining deleted content.
