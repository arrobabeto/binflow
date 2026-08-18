# Decision log

This page summarizes active decisions. The linked ADR is authoritative.

| Decision                                                                                                                | Status   | ADR                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| Documentation-first delivery is mandatory                                                                               | Accepted | [ADR-0001](adr/0001-documentation-first.md)                                  |
| TypeScript/pnpm monorepo with separated apps                                                                            | Accepted | [ADR-0002](adr/0002-typescript-monorepo.md)                                  |
| PostgreSQL is durable state; Redis is transient coordination                                                            | Accepted | [ADR-0003](adr/0003-postgresql-and-redis.md)                                 |
| LangGraph runs workflows; BullMQ transports start/resume work                                                           | Accepted | [ADR-0004](adr/0004-langgraph-and-bullmq.md)                                 |
| Capabilities and manifests bound deterministic executors                                                                | Accepted | [ADR-0005](adr/0005-capabilities-and-manifests.md)                           |
| Exact preview and version-bound approval are mandatory                                                                  | Accepted | [ADR-0006](adr/0006-preview-and-approval.md)                                 |
| Two Telegram bot roles use a shared gateway abstraction                                                                 | Accepted | [ADR-0007](adr/0007-telegram-topology.md)                                    |
| OpenAI per client is the first provider policy                                                                          | Accepted | [ADR-0008](adr/0008-openai-credentials.md)                                   |
| Dashboard uses password + TOTP                                                                                          | Accepted | [ADR-0009](adr/0009-admin-authentication.md)                                 |
| Local-first delivery remains VPS-ready                                                                                  | Accepted | [ADR-0010](adr/0010-local-first-production-ready.md)                         |
| Translation is policy-driven internal workflow behavior                                                                 | Accepted | [ADR-0011](adr/0011-locales-and-translation.md)                              |
| GitHub App and Vercel preserve Git as source of truth                                                                   | Accepted | [ADR-0012](adr/0012-github-vercel-publication.md)                            |
| The pilot GitHub App has an administrative registration ceiling but repository- and operation-downscoped runtime tokens | Accepted | [ADR-0013](adr/0013-github-app-administrative-registration.md)               |
| Provider credentials have explicit owner scope and candidates activate only after read-only verification                | Accepted | [ADR-0014](adr/0014-integration-credential-scope-and-verification.md)        |
| Nuxt owns auth ingress while Fastify business operations use explicit audited database scopes                           | Accepted | [ADR-0015](adr/0015-administrative-ingress-and-scoped-database-execution.md) |
