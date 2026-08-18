# Architecture Decision Records

ADRs preserve why durable decisions exist. Accepted ADRs are binding until a later ADR explicitly supersedes them.

## Index

| ADR                                                                  | Decision                                                       | Status   |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-documentation-first.md)                                  | Documentation-first delivery                                   | Accepted |
| [0002](0002-typescript-monorepo.md)                                  | TypeScript/pnpm monorepo                                       | Accepted |
| [0003](0003-postgresql-and-redis.md)                                 | PostgreSQL durable state and Redis coordination                | Accepted |
| [0004](0004-langgraph-and-bullmq.md)                                 | LangGraph workflows and BullMQ transport                       | Accepted |
| [0005](0005-capabilities-and-manifests.md)                           | Typed capabilities and manifests                               | Accepted |
| [0006](0006-preview-and-approval.md)                                 | Exact preview and version-bound approval                       | Accepted |
| [0007](0007-telegram-topology.md)                                    | Admin bot plus dedicated client bots                           | Accepted |
| [0008](0008-openai-credentials.md)                                   | Per-client OpenAI credentials                                  | Accepted |
| [0009](0009-admin-authentication.md)                                 | Password and TOTP admin authentication                         | Accepted |
| [0010](0010-local-first-production-ready.md)                         | Local-first, VPS-ready delivery                                | Accepted |
| [0011](0011-locales-and-translation.md)                              | Locale and translation policy                                  | Accepted |
| [0012](0012-github-vercel-publication.md)                            | GitHub/Vercel publication model                                | Accepted |
| [0013](0013-github-app-administrative-registration.md)               | GitHub App administrative registration and runtime downscoping | Accepted |
| [0014](0014-integration-credential-scope-and-verification.md)        | Integration credential scope and candidate verification        | Accepted |
| [0015](0015-administrative-ingress-and-scoped-database-execution.md) | Administrative ingress and scoped database execution           | Accepted |
| [0016](0016-platform-owner-bootstrap-and-session-assurance.md)       | Platform-owner bootstrap and session assurance                 | Accepted |
| [0017](0017-resumable-enrollment-and-activation-evidence.md)         | Resumable enrollment and activation evidence                   | Accepted |
| [0018](0018-dashboard-credential-enrollment-boundary.md)             | Dashboard credential enrollment boundary                       | Accepted |
| [0019](0019-versioned-project-manifest-and-budget-policy.md)         | Versioned project manifest and budget policy                   | Accepted |
| [0020](0020-code-owned-capability-catalog-and-project-binding.md)    | Code-owned capability catalog and project binding              | Accepted |
| [0021](0021-telegram-ingress-and-durable-request-kernel.md)          | Telegram ingress and durable request kernel                    | Accepted |

Use [0000-template.md](0000-template.md) for new decisions.
