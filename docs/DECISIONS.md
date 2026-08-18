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
| The sole platform owner is bootstrapped locally and business access requires a fresh, server-validated TOTP session     | Accepted | [ADR-0016](adr/0016-platform-owner-bootstrap-and-session-assurance.md)       |
| Client onboarding is resumable and activation requires current named validation evidence                                | Accepted | [ADR-0017](adr/0017-resumable-enrollment-and-activation-evidence.md)         |
| Dashboard credential enrollment uses API-only KEK access and one-time secret submission                                 | Accepted | [ADR-0018](adr/0018-dashboard-credential-enrollment-boundary.md)             |
| Project manifests bind immutable locale, provider, path and budget snapshots derived from a code-owned profile          | Accepted | [ADR-0019](adr/0019-versioned-project-manifest-and-budget-policy.md)         |
| Capability definitions are code-owned and projects bind only immutable approved versions                                | Accepted | [ADR-0020](adr/0020-code-owned-capability-catalog-and-project-binding.md)    |
| Telegram ingress resolves durable identities and uses a PostgreSQL-authoritative request kernel                         | Accepted | [ADR-0021](adr/0021-telegram-ingress-and-durable-request-kernel.md)          |
| Blog execution renders exact artifacts and separates preview approval from publication                                  | Accepted | [ADR-0022](adr/0022-complete-blog-execution-and-publication.md)              |
| Admin Telegram pairing and durable notifications are explicit production-readiness boundaries                           | Accepted | [ADR-0023](adr/0023-admin-notifications-and-production-readiness.md)         |
