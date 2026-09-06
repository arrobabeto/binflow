# Scope and boundaries

## First MVP: in scope

### Platform

- Documentation-first TypeScript monorepo.
- Multi-tenant-ready isolation with one active project per enrollment, one
  primary client (owner) Telegram identity, and at most one optional **Piloter**
  identity on the same dedicated client bot (ADR-0057).
- Admin dashboard with password + TOTP authentication.
- Managed onboarding for the `astro_repo` profile (first MVP) and, as
  post-MVP expansions, the `astro_orbitype` profile (enrollment + Orbitype API
  key; see ADR-0045) and the `shopify_liquid` profile (Shopify Liquid theme
  enrollment; see ADR-0059).
- PostgreSQL, Redis/BullMQ, workflow checkpoints and S3-compatible artifacts.
- Per-client OpenAI credential; no global fallback.
- Structured audit, model usage and cost records.
- Local operation with production-ready container definitions.

### Telegram

- One global admin bot.
- One dedicated client bot per first-MVP enrollment.
- Direct messages, text, images and supported documents.
- Natural-language intent routing and explicit slash commands.
- Dynamic tool menu, status, revision, approval and cancellation.
- Admin notifications and approvals shared with the dashboard.
- Bounded admin→client Telegram direct messages from the dashboard (ADR-0043),
  including ticket-scoped messages (ADR-0055).
- Admin **Tickets** queue for out-of-catalog client requests (states, read
  receipt, messaging). Clients open tickets via Telegram `/open_ticket` or the
  unmatched-message fallback; greeting heuristics reply politely without a
  ticket (ADR-0055).
- Optional **Piloter** on the dedicated client bot: platform owner assigns a
  subset of already-bound tools; Piloter pairs via a one-time link; owner
  receives template notices of Piloter success; requests/tickets record
  Owner | Piloter (ADR-0057).
- Post-MVP: `shopify_liquid` enrollment for Shopify Liquid themes (GitHub theme
  repo; no Shopify Admin API in v1); first content tool family is inventory-
  driven `edit_image` (ADR-0059 / ADR-0058).

### First capability

- Global `create_blog_draft` capability bound to an `astro_repo` project manifest.
- Brief and draft modes.
- Topic-only minimum for brief mode.
- Category discovery, typo normalization and new-category approval escalation.
- Content-catalog sync and duplicate/overlap protection.
- Controlled research, multilingual generation, internal translation node and image generation/processing.
- Branch, commit, PR, CI checks, exact Vercel preview, revision loop, approval, merge and production verification.
- Webbin-specific ES/EN contract through a project manifest, not hardcoded capability logic.

### Pilot

- Webbin is the first real `astro_repo` project.
- A separate onboarding PR may add preview-safe configuration or CI when required.
- The final MVP acceptance publishes one real, approved article.

## Explicitly outside the first MVP

- More than one project per enrollment.
- More than one Piloter per enrollment, or additional client users beyond
  owner + optional Piloter (ADR-0057).
- Public registration, autoenrollment or customer billing.
- Client dashboard.
- Anthropic or provider failover.
- Global platform API grants.
- User-visible translation capability; translation is an internal node.
- Freeform Markdown/WYSIWYG editing in the dashboard.
- Scheduling.
- Voice, Telegram groups/channels or a shared client bot.
- General code, CSS, dependency, infrastructure, authentication or workflow changes requested by an LLM.
- Shell, filesystem, generic SQL, merge or publication tools exposed to the LLM.
- Automatic rollback (except compensating restore of temporary preview CMS
  patches for `edit_image` / `edit_text` / `edit_text_style` — ADR-0051 /
  ADR-0052 / ADR-0053).
- Production VPS provisioning.
- Validated German publication until a compatible real pilot exists.
- WordPress runtime support as a separate later phase.
- Orbitype content tools beyond the accepted `create_blog_orbitype` dual-write
  create path (ADR-0047) and the accepted page/image edit capabilities
  (ADR-0051 / ADR-0052); enrollment remains ADR-0045.

## Permanent safety boundaries

The following remain out of scope unless a separate product and security design supersedes this document:

- Unrestricted LLM access to hosts, SSH, Docker sockets or production credentials.
- Direct writes to a shared production branch.
- Publication without preview and version-bound approval.
- Silent overwrites of content changed outside Binflow.
- LLM-defined executors, permissions, manifests or approval policies.
- Treating generated rationale as private model chain-of-thought.

## Change classification

| Request                                             | Handling                                               |
| --------------------------------------------------- | ------------------------------------------------------ |
| Enabled capability and valid manifest binding       | Create typed request workflow.                         |
| Known capability disabled for project               | Explain that it is unavailable; do not execute.        |
| New typed binding within existing global capability | Admin onboarding/configuration change with validation. |
| Capability requiring a new executor                 | Product development proposal and ADR if architectural. |
| General code/layout/infrastructure request          | Human development brief; never automatic execution.    |
| Out-of-catalog custom ask (ticket)                  | Admin ticket queue; no invented capability run.        |
