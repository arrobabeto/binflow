# Operations

## Environments

### Local MVP

- PostgreSQL, Redis, MinIO and ClamAV through Docker Compose.
- API, dashboard, worker, maintenance and one-shot CLI services are packaged in Docker from Phase 0; supervised host processes remain an optional development convenience.
- Local and production profiles build the same versioned first-party images.
- Telegram uses polling.
- GitHub/Vercel state may be reconciled by API polling.
- Real external mutations require explicit test/pilot configuration, never production secrets in committed files.

Start durable dependencies with `docker compose -f infra/compose/local.yml up -d postgres redis minio clamav`, then apply migrations with `pnpm db:migrate`. The same Compose file can build the current API, dashboard, worker and maintenance images; the CLI intentionally runs in the trusted host terminal so interactive secret input never traverses Compose configuration.

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

Use the Phase 0 credential CLI documented in [public contracts](CONTRACTS.md#phase-0-credential-cli). Values are entered only through non-echoed prompts. Shell arguments, committed `.env` files and Compose YAML are not credential entry mechanisms.

Production supplies the KEK as a Docker secret. Database records contain one random DEK and AES-256-GCM encrypted envelope per credential version; the KEK itself is never stored in PostgreSQL.

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
