# Architecture Decision Records

ADRs preserve why durable decisions exist. Accepted ADRs are binding until a later ADR explicitly supersedes them.

## Index

| ADR                                                                  | Decision                                                       | Status   |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | -------- |
| [0001](0001-documentation-first.md)                                  | Documentation-first delivery                                   | Accepted |
| [0002](0002-typescript-monorepo.md)                                  | TypeScript/pnpm monorepo                                       | Accepted |
| [0003](0003-postgresql-and-redis.md)                                 | PostgreSQL durable state and Redis coordination                | Accepted |
| [0004](0004-langgraph-and-bullmq.md)                                 | TypeScript workflow runtime and BullMQ transport               | Accepted |
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
| [0022](0022-complete-blog-execution-and-publication.md)              | Complete blog execution and publication                        | Accepted |
| [0023](0023-admin-notifications-and-production-readiness.md)         | Admin notifications and production readiness                   | Accepted |
| [0024](0024-rolling-idle-dashboard-session.md)                       | Rolling 30-minute idle dashboard session                       | Accepted |
| [0025](0025-delivered-client-pairing-activation.md)                  | Delivered client pairing activates enrollment                  | Accepted |
| [0026](0026-telegram-inline-action-buttons.md)                       | Telegram inline buttons for client actions                     | Accepted |
| [0027](0027-client-notification-outbox.md)                           | Client-notification outbox for admin cancellation              | Accepted |
| [0028](0028-idempotent-publication-after-merge.md)                   | Idempotent publication after GitHub merge                      | Accepted |
| [0029](0029-client-visible-production-origin.md)                     | Client-visible production URLs use webbin.com.mx               | Accepted |
| [0030](0030-declarative-tools-and-client-customization.md)           | Declarative tools, node kinds and client customization         | Accepted |
| [0031](0031-context-first-blog-brief.md)                             | Context-first blog brief with provisional topic                | Accepted |
| [0032](0032-surgical-blog-revision.md)                               | Surgical blog revision with confirmed revision plan            | Accepted |
| [0033](0033-create-project-draft-portfolio-tool.md)                  | Create project draft portfolio capability                      | Superseded by ADR-0034 |
| [0034](0034-create-project-astro-reusable-tool.md)                   | Reusable create_project_astro tool, manifest structure, upload | Accepted |
| [0035](0035-project-content-schema-dsl-and-collection-loop.md)       | Project content-schema DSL and conversational collection loop  | Accepted |
| [0036](0036-portfolio-hero-screenshot-cover.md)                      | Portfolio cover from hero screenshot; required Webbin URL      | Accepted |
| [0037](0037-project-year-month-url-evidence-avif-cover.md)           | Year-month fecha, URL evidence, AVIF covers, fact merge        | Accepted |
| [0038](0038-capability-runtime-registry.md)                          | Capability runtime registry and catalog-backed graph versions  | Accepted |
| [0039](0039-tool-authoring-pipeline.md)                              | Tool authoring pipeline (brief, scaffolder, conformance)       | Accepted |
| [0040](0040-destructive-content-capabilities.md)                     | Destructive content capabilities (delete project)              | Proposed |
| [0041](0041-defer-delete-blog-redirects.md)                          | Defer delete-blog post-deletion redirects                      | Accepted |

Use [0000-template.md](0000-template.md) for new decisions.
