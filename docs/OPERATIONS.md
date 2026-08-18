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
- GitHub/Vercel state may be reconciled by API polling.
- Real external mutations require explicit test/pilot configuration, never production secrets in committed files.
- Schema migrations use the database owner connection. API, worker, dashboard
  auth and maintenance use a distinct non-owner runtime role so RLS is effective.
- Dashboard readiness requests `/login`, which also proves that the auth secret
  and PostgreSQL-backed session runtime can initialize; Caddy waits for this
  health check in production.

Start durable dependencies with `docker compose -f infra/compose/local.yml up -d postgres redis minio clamav`, then apply migrations with `pnpm db:migrate`. The same Compose file can build the current API, dashboard, worker and maintenance images; the CLI intentionally runs in the trusted host terminal so interactive secret input never traverses Compose configuration.

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

### Secret

- Database, Redis and object-store credentials.
- Better Auth secret and bootstrap material.
- SecretsProvider KEK.
- Telegram, OpenAI, GitHub App, Vercel and future integration credentials.

Production secrets use Docker secrets or a future managed secret provider. They never appear in Compose files, images, Git or documentation.

### Local Phase 0 secret bootstrap

Before storing an integration, run `pnpm binflow secret init` from an interactive terminal. It creates a random 256-bit KEK at the configured host location outside the repository, sets mode `0600` and prints only the resulting reference. Binflow refuses to initialize or start secret-dependent operations when the key path is inside the repository, is not a regular file, has broader permissions or does not contain exactly the supported key material.

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
the dashboard or API. Local development uses a regular `0600` file and exports
only its path through `BINFLOW_AUTH_SECRET_FILE`; production mounts the same
secret class as `/run/secrets/auth_secret`. Do not reuse the SecretsProvider KEK.

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

Endpoints:

- Liveness: process event loop is responsive.
- Readiness: required database connection and migrations are healthy; API can refuse mutation readiness while serving diagnostics.
- Dependency detail is admin-authenticated and redacted.

Dashboard health surfaces PostgreSQL, Redis, worker heartbeat, queue depth, artifact store and external integration status.

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
