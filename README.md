# Binflow

Binflow is a private, documentation-first WebOps control plane. It turns requests from approved Telegram users into typed, auditable workflows that prepare website changes, generate an exact preview, collect the required approvals, publish through the project's source of truth, and verify production.

The repository is implementing Phase 0 from an accepted documentation baseline. Application changes must continue to follow the documentation-first workflow and remain within the current phased roadmap.

## Local foundation

Prerequisites are Node.js 24, pnpm 10.28.1 and current Docker Desktop.

```text
pnpm install
docker compose -f infra/compose/local.yml up -d postgres redis minio clamav
pnpm db:migrate
pnpm check
pnpm test
pnpm build
```

The API and dashboard can then run with `pnpm dev`, or every first-party process can be built through the local Compose profile. The API health contract is available at `http://localhost:8080/api/v1/health`; the dashboard uses port `3000`.

Credential values are never placed in `.env` or command arguments. After PostgreSQL is healthy, initialize the external master key and draft pilot scope:

```text
pnpm binflow secret init
pnpm binflow scope init --tenant webbin --project webbin
```

Then use the documented interactive `pnpm binflow integration set ...` commands. Real provider verification remains a Phase 0 gate and should not be attempted until the corresponding adapter reports readiness.

## Start here

- [Documentation index](docs/README.md)
- [Product definition](docs/PRODUCT.md)
- [MVP definition](docs/MVP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [Documentation governance](docs/DOCUMENTATION-GOVERNANCE.md)
- [Initial implementation roadmap](docs/ROADMAP.md)

## Non-negotiable rule

Every code, configuration, schema, infrastructure, feature, behavior, security, or scope change must update its canonical documentation in the same change. A change is not complete while the documentation describes the previous behavior.

See [AGENTS.md](AGENTS.md) and the [Definition of Done](docs/DEVELOPMENT.md#definition-of-done).
