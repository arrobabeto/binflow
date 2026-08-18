# Phased implementation roadmap

## Phase 0 — Foundation and feasibility

Deliverables:

- Node.js 24 LTS repository, monorepo conventions and CI skeleton.
- Versioned Dockerfiles plus local and production Compose definitions from the first implementation slice; the same application images remain VPS-ready.
- Idempotent CLI bootstrap for a draft tenant/project ownership scope before dashboard onboarding exists.
- Domain packages, schema strategy, adapters and representative fakes.
- SecretsProvider foundation with per-credential AES-256-GCM envelopes, an external 256-bit KEK and the interactive credential CLI.
- CLI setup/verification path for OpenAI, both Telegram bots, the Webbin-only GitHub App installation and Vercel without secrets in arguments or committed files.
- Spikes for two Telegram bots, OpenAI structured output/research/image, GitHub App permissions and Vercel SHA correlation.
- Webbin preview and Web3Forms safety assessment.
- Accepted baseline ADRs and threat model.

Exit: every external dependency needed by the MVP has a verified path or an explicit blocking result.

## Phase 1 — Administrative control plane

Deliverables:

- Better Auth password/TOTP/backup-code flow, single platform-owner bootstrap,
  database-backed rate limits and revocable session gates.
- Tenant/project isolation, RLS, artifact store, audit and outbox.
- Dashboard credential management backed by the Phase 0 SecretsProvider and integration application services.
- English dashboard and resumable `astro_repo` onboarding wizard.
- Provider, bot, GitHub, Vercel, manifest, capability, locale, budget and catalog management.
- Reversible activation validation and one-time client pairing.
- Same-origin administrative ingress, explicit database execution scopes,
  durable idempotency, audit and transactional outbox foundation.

Exit: Webbin can be configured and activated without manual database editing.

## Phase 2 — Telegram and workflow kernel

Deliverables:

- Admin and client bots, local polling and production webhook mode.
- Identity resolution, menu, commands, natural-language routing and attachments.
- LangGraph coordinator, request state machine, checkpoints, versions and approvals.
- Progress/admin notifications, cancellation and status lookup.

Exit: a paired client can create, confirm, resume and cancel a typed plan; cross-tenant and replay attempts fail.

## Phase 3 — Complete blog capability (MVP milestone)

Deliverables:

- Catalog sync, similarity, research, editorial generation, translation and image nodes.
- `astro_repo` executor and Webbin manifest.
- GitHub branch/commit/PR flow, CI validation, Vercel preview and revision loop.
- Client approval, conditional admin category approval, automatic merge and production verification.
- Full audit, usage/cost accounting and attachment cleanup.

Exit: one real approved Webbin article completes the end-to-end flow.

## Phase 4 — Production hardening

Deliverables:

- VPS deployment, Caddy/TLS and webhook cutover.
- Offsite encrypted backups and tested restore.
- Metrics, alerts, budgets, rate limiting and dead-letter operations.
- Secret rotation, container update, incident and rollback runbooks.
- Failure drills for PostgreSQL, Redis, workers, OpenAI, GitHub and Vercel.

Exit: production readiness review passes and recovery objectives are demonstrated.

## Phase 5 — Expanded `astro_repo` capabilities

Implement in order:

1. `edit_blog_draft`.
2. `replace_blog_media_draft`.
3. `update_seo_meta_draft`.
4. `update_page_copy_draft`.
5. `replace_site_image_draft`.
6. `propose_blog_category`.
7. `manage_typed_sections_draft`.

Every capability reuses the same policy, translation, version, preview, approval and audit boundaries.

## Phase 6 — Orbitype profiles

- Validate auth, schemas, drafts, versions, webhooks and rollback.
- Implement allowlisted MCP adapter with typed HTTP fallback.
- Validate `astro_orbitype`, then `nuxt_orbitype`, against separate real or staging pilots.

## Phase 7 — WordPress profile

- Implement posts/categories/blog-media-only REST adapter.
- Build and audit WebOps Signed Preview plugin.
- Validate new posts and edit-clone flows against WordPress staging.

## Phase 8 — Product expansion

- Multiple projects and client users per tenant.
- Granular roles, global provider grants and additional channels.
- Client dashboard, scheduling, assisted rollback, multi-approver policies and expanded cost accounting.

Each phase requires updated product, scope, architecture, contracts, security, testing and operations documentation before implementation begins.
