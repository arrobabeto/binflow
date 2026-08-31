# Documentation and product changelog

All notable changes to product behavior, architecture, contracts, security, operations and scope are recorded here. This is not a substitute for detailed canonical documents or ADRs.

## Unreleased

### Home metrics + recent tickets

- Home status strip uses a full request cursor walk (same helper as Analytics)
  with `useRequestFetch`. Request list contracts accept platform
  `capabilityId: open_ticket` so `/open_ticket` rows no longer 400 the list.
- Fourth KPI is **Open tickets** (large) with **tickets in total** underneath
  (`pendingCount` / `totalCount`); polls ~5s. Client cards keep live per-project
  request counts from the same catalog.

### Telegram `/open_ticket` (custom ask → admin ticket)

- Unmatched client messages offer custom request or `/tools` instead of a dead
  end; `/open_ticket` interview + LLM summary/estimate; confirm sends ADR-0055
  ticket and a short admin Telegram notice (ADR-0055 ingest complete).
- Greeting/thanks heuristic replies politely without opening a ticket.
- Spec: `docs/specs/open-ticket-telegram.md`.

### Admin tickets queue (UI + contracts)

- Main nav **Tickets** under Requests; `/tickets` Pending/History inbox and
  `/tickets/:id` detail (ADR-0055, ADR-0044 surfaces).
- States `new` | `in_process` | `declined` | `closed`; resolve → `closed`;
  unread via `readAt`; Message client reuses ADR-0043 outbox with aggregate
  `ticket` / `admin.ticket_message` and a localized prefix
  `Respuesta al ticket {publicId}:` (not the generic Binflow-admin banner).
- Platform-owner API list/get/patch/read/message-target/messages; Telegram
  `/open_ticket` ingest creates tickets (ADR-0055).

### update_menu: opt-in button selection interview

- After PDF upload, menu CTAs start **unselected**; client taps to choose which
  buttons receive the new PDF (ADR-0049 amendment).
- New selection CTAs: **Seleccionar todos** / Select all / Alle auswählen;
  **Continuar** / Continue / Weiter (primary); Cancel localized on selection
  and plan steps.
- Empty Continuar uses pick-at-least-one copy instead of the no-CTAs-found
  message. Other tools unchanged (ADR-0042).

### Client Telegram tool catalog (`/tools` + `/info`)

- `/tools` keeps the compact `command — displayName` list and adds a footer
  pointing to `/info` (ADR-0054).
- New `/info` and `/info <tool>` for localized scope/detail without starting a
  request; resolves capability id, slash command, or title; misses stay
  project-scoped.
- `/help` and pairing copy point to `/tools` / `/info`.
- Code-owned catalog copy (`de`/`en`/`es`) for `/info` and `setMyCommands`
  descriptions when synced.

### edit_text_style: visible spans + fail-closed preview restore

- Pilot Bistro: render allowlisted `text` bodies (e.g. `SectionStory`) via
  `CmsText` so surgical `<span data-binflow-style>` styles are not escaped as
  literal HTML. Deploy Bistro to take effect on production.
- `edit_text_style` cancel/admin-reject restore: look up `text_style_patch` by
  request version, then fall back to latest patch for the request; missing
  artifact / store / snapshot now marks `orbitypeRestoreFailed` instead of a
  silent no-op. Other tools’ CTAs and flows unchanged (ADR-0042).

### Surgical text style + preserved edit_text (isolation)

- **`edit_text_style`**: apply weight/size/color by wrapping `targetExcerpt` in
  `<span style="…" data-binflow-style="1">` so CMS-backed Astro sites show the
  change; sibling `${field}Style` is no longer the visibility contract
  (ADR-0053 amendment). `verify_production` checks styled markup for the
  excerpt.
- **`edit_text`**: unchanged usage — substring locates the field; execute still
  replaces the **whole field** with `newValue` (ADR-0051). CTAs, commands, and
  messages stay the prior edit_text surface (ADR-0042 isolation).
- Pilot Bistro: sanitize allows safe `span` styles; editable title/lead/body
  fields render via sanitized HTML so inline styles are not escaped.
  Site-only change; does not alter other Binflow capabilities.

### Edit text style (`edit_text_style`, astro_orbitype)

- New capability **`edit_text_style@1`** (ADR-0053): change weight, size, and/or
  color on one allowlisted text target without rewriting copy; dual-write GitHub
  plus Orbitype; Vercel preview with client **Approve/Cancel only**; admin
  approval before merge.
- Guardrails: one `fieldKind` per request (mixed → cancel); HEX ≤2 retries then
  cancel; isolated CTAs (`confirm_text_style_*`, Aplicar estilo / Apply style).
- Style collection is a stepped interview (menu → one attribute → back to menu;
  Done after ≥1). Missing target text shows a retry message.
- Preview temporarily patches Orbitype after Vercel is ready; snapshot restored
  on client cancel / admin reject via `restore_orbitype_preview`.
- Ingress: English phrases such as “edit text style” / “change text style” and
  German `Schriftstil` match `edit_text_style` (not only ES stems). Plan confirm
  shows human weight/size/color lines — never raw JSON style objects.
- Packages: shared discovery in `@binflow/text` plus `EditTextStyleExecutor` and
  `TextStyleWorkflowRuntime` — no changes to `edit_text` / `edit_image` graphs.
- Migration `0030_edit_text_style_capability.sql`; graph
  `stacks/astro-orbitype/edit-text-style@1`.
- Spec: `docs/specs/edit-text-style.md`.
- Bistro binding script:
  `packages/tools/scripts/add-bistro-edit-text-style-binding.ts`.

### Edit site image (`edit_image`, astro_orbitype)

- New capability **`edit_image@1`** (ADR-0052): replace one allowlisted page or
  blog image slot per request (deny page heroes / logos; allow blog cover/hero);
  dual-write GitHub plus Orbitype; Vercel preview with client **Approve/Cancel
  only**; admin approval before merge (preview URL in admin notice).
- Multilingual: no locale pick; one asset patches all `contentLocales`.
- Collection: target search → confirm (current photo) → replacement
  (Telegram photo or HTTPS URL) → plan confirm.
- Replacement HTTPS URLs: no credentials, blocked localhost/private hosts, no
  redirects, MIME (JPEG/PNG/WebP) and size caps before artifact store.
- Telegram images sent as files (`type: file`/`document`) are accepted as
  inbound photos for `edit_image` / covers; unsupported-attachment copy is no
  longer the menu-PDF-only message.
- Replacement files write under manifest `imageDirectory`
  (`public/images/blog/edit-*.{avif,jpg,png,webp}`); Orbitype editablePaths
  include png/webp. Bistro rematerialize:
  `packages/tools/scripts/add-bistro-edit-image-binding.ts`.
- Preview temporarily patches Orbitype after Vercel is ready so CMS-backed
  sites show the change; image CMS uses the **absolute preview asset URL**,
  then post-merge publish rewrites the **relative** path. Snapshot restored on
  client cancel / admin reject via `restore_orbitype_preview` (ADR-0052).
- Spec documents blog `imageDirectory` paths (not `public/images/edits/**`).
- Admin `admin_approval_required` for `edit_image` includes Vercel preview URL
  buttons on the admin card (outbox `previewUrls` → Chat SDK LinkButtons).
- Target confirm (`¿Cambiar esta imagen…?`) includes the absolute current image
  URL under the label so the client can open and verify the asset visually.
- Packages: `@binflow/images`; additive runtime/ingress/worker wiring — no
  changes to existing tool graphs or executors.
- Migration `0029_edit_image_capability.sql`; graph
  `stacks/astro-orbitype/edit-image@1`.
- Spec: `docs/specs/edit-image.md`.

### Edit page text (`edit_text`, astro_orbitype)

- New capability **`edit_text@1`** (ADR-0051): literal replacement of one
  allowlisted paragraph or non-H1 section title per request; dual-write GitHub
  `cms/collections/**` mirror plus Orbitype `pages.sections`; Vercel preview with
  client **Approve/Cancel only**; admin approval before merge.
- Preview temporarily patches Orbitype after Vercel is ready so CMS-backed
  sites show the change; snapshot restored on client cancel / admin reject via
  `restore_orbitype_preview` (ADR-0051).
- Packages: `@binflow/text`; additive runtime/ingress/worker wiring — no
  changes to existing tool graphs or executors.
- GitHub draft always includes ≥1 file under `cms/collections/**` (patch existing
  mirror when found, otherwise write `cms/collections/pages/{slug}.json`) so
  `createDraft` never fails with empty files.
- Admin/client approval copy for `edit_text` is capability-specific (text edit,
  not blog category); blog category wording unchanged.
- Migration `0028_edit_text_capability.sql`; graph
  `stacks/astro-orbitype/edit-text@1`.
- Spec: `docs/specs/edit-text.md`.
- Bistro manifest binding script: `packages/tools/scripts/add-bistro-edit-text-binding.ts`
  (manifest v8+ includes `edit_text@1` alongside existing blog/menu tools).

### Admin Telegram approval actions (ADR-0050)

- Spec: `docs/specs/admin-telegram-approval.md`.
- Paired admin bot receives summary card with **Approve** / **Reject** for
  `AWAITING_ADMIN_APPROVAL`; same idempotent service as dashboard.
- Reject (Telegram or dashboard) → **`CANCELLED`** + client `request.cancelled`;
  no longer `REVISION_REQUESTED` / `admin_rejected`.
- ADR-0043 request-scoped Message after reject superseded for new rejects.

### Update menu verify polling

- `verify_production` polls the public menu PDF URL for up to 120s after merge
  so Vercel/CDN propagation does not false-fail an otherwise successful update.

### Update menu (`update_menu`, astro_orbitype)

- New capability **`update_menu@1`** for enrolled **`astro_orbitype`** sites
  (ADR-0049): Telegram PDF upload (max 10 MB), menu-semantics CTA discovery
  across all Orbitype pages, multi-select button toggles, plan-confirm-only
  approval, dual-write versioned PDF to GitHub plus `ctaHref` /
  `ctaSecondaryHref` patches on `pages.sections`, production verification
  without Vercel preview.
- Packages: `@binflow/menu`, Orbitype menu pages port, worker/menu workflow
  runtime, Telegram document ingress (`documentArtifactKey`).
- Migration `0027_update_menu_capability.sql`; graph
  `stacks/astro-orbitype/update-menu@1`.
- Bistro customization: `docs/customizations/bistro-update-menu.md`; manifest
  refresh script adds `public/documents/*.pdf` editable path.

### Active client profile edits (production URL)

- Platform owners can PATCH enrollments in `active` / `pairing_pending` /
  `revalidation_required` without resetting to `configuring`. Saving rematerializes
  the frozen manifest when configuration changes (e.g. `productionDomain` →
  `deployment.productionOrigin`). Dashboard label is **Save profile** for live
  clients. Corrected Webbin enrollment domain `https://webbin.mx` →
  `https://webbin.com.mx`.

### Analytics dashboard page

- System nav adds **Analytics** (`/analytics`) from Figma `analytics-dashboard`.
- Live panels: approximate request totals and tool usage/failures from request
  batches; models donut from tool-graph agent nodes; client status rows.
- Cost, latency, budget spend, cost alerts, and model efficiency show
  **Available soon** until `GET /api/v1/usage` (and related) exist.
- Analytics loads the full request list via cursor pagination (not a single
  50-item page) so range filters report exact totals for request-derived
  panels; `50+` only appears if the safety page cap truncates.
- Analytics date range (Last 24 hours / 7 / 30 days / All time) filters
  request-derived panels by `createdAt`; cost panels remain soon.

### GitHub App binding is project-scoped

- Worker resolves `github-app` via the project's active
  `integration_connections` row (installation + repository evidence), not any
  platform-wide active credential. Verifying a second GitHub App no longer
  supersedes a different `appId` at platform scope.
- Unique active credential index includes `configuration.appId` so distinct
  GitHub Apps can both be `active` (migration `0026`).
- Root cause of Webbin create-blog "Vercel timeout": Bistro's App enrollment
  superseded Webbin's binding, so Webbin drafts were pushed to
  `Bistro-Zur-Linde` while preview waited on Webbin's Vercel project.

### Content locales fail-closed on generate

- Blog generate receives the frozen enrollment locale contract and **rejects**
  primary prose whose detected language is outside `contentLocales` (e.g.
  Spanish body when Bistro is DE-only / conversation `es`). One model retry,
  then fail. Conversation locale never authorizes publishable language.

### Astro Orbitype tool manual + stack contracts

- Guide: `docs/guides/astro-orbitype-tool-implementation.md` (ports, manifest
  freeze, ops gates, Bistro failure appendix).
- create-tool / test-tool / new-stack load per-stack contracts under
  `.cursor/skills/create-tool/references/stacks/`.
- Shared Telegram delete examples and delete production-origin defaults no
  longer bake Webbin URLs; origin comes from frozen manifest (Webbin fallback
  only for `astro_repo`).

### Enrolled client production origin (ADR-0048)

- Client-visible production URLs use frozen manifest
  `deployment.productionOrigin` (from enrollment `productionDomain`), not the
  Webbin-only constant. Worker falls back to active enrollment, then Webbin.
- Rematerialize Bistro:
  `pnpm --filter @binflow/tools exec tsx scripts/refresh-bistro-manifest-blog-paths.ts`.

### Pull request provider id scoped per project

- `pull_requests` unique index is `(project_id, provider_id)` instead of global
  `provider_id`. GitHub PR numbers collide across repos (Webbin #21 vs Bistro
  #21); the old index left Orbitype create-blog stuck in `PREVIEW_DEPLOYING`
  after a READY Vercel preview when persisting the PR row.
- Blog/project execute paths upsert by project + provider id (idempotent retry).

### Astro Orbitype preview routes + Vercel Preview env

- `blogPreviewRoutes` for `astro_orbitype` builds `/posts/{draftId}/{titleSlug}`
  (Bistro CMS pages), not `/{locale}/{slug}`.
- Enrollment runbook: Astro `PUBLIC_*` vars required for **Preview** as well as
  Production (missing `PUBLIC_SITE_URL` caused Bistro PR builds to fail with
  `BUILD_UTILS_SPAWN_1`).
- Manifest `routePrefix` for Orbitype collections is `/posts`.

### Orbitype Bistro posts dual-write + retry loop

- `createOrbitypeBlogPublicationPort` writes Bistro-shaped `posts` rows
  (`title`/`lead`/`status`/`sections` JSON) instead of invented columns; SQL
  4xx maps to `provider_final` (`orbitype_draft_failed`) so BullMQ does not
  retry schema failures forever.
- Stale GENERATING/QUEUED recovery outbox keys are stable per request version
  (`onConflictDoNothing`) to stop recover→retry loops.

### Astro Orbitype blog path allowlist

- `matchesEditablePath` treats `dir/**/*.md` as matching files directly under
  `dir/` (and nested). `astro_orbitype` editablePaths use `blog-{locale}/*.md`.
- Rematerialize Bistro:
  `pnpm --filter @binflow/tools exec tsx scripts/refresh-bistro-manifest-blog-paths.ts`.

### Telegram polling recovery and client failure notices

- Worker keeps Telegram polling locks on a dedicated Redis connection (not the
  BullMQ blocking connection) and promotes send-only bot runtimes to polling
  once the lock is free, so a brief dual-worker overlap no longer leaves
  ingress dead until restart.
- `FAILED_FINAL` also enqueues a client Telegram notice (admin notice unchanged).

### GitHub publication uses verified project binding

- `createGitHubRepositoryPublicationPort` no longer rejects non-Webbin
  `expectedRepository` / `defaultBranch`. Draft PRs target the enrolled
  connection binding (required for `astro_orbitype` / Bistro dual-write).
  Webbin pilot verifier rules for the Webbin repository itself are unchanged.

### Create blog Orbitype dual-write (ADR-0047)

- Capability `create_blog_orbitype@1` on stack `astro-orbitype`: GitHub draft PR
  plus allowlisted Orbitype CMS draft/publish, Vercel preview, independent
  writer nodes. Spec: `docs/specs/create-blog-orbitype.md`. Freezes
  `create_blog_draft` / `astro_repo`. Locales from project manifest (ADR-0046).
  Pilot customization: Bistro (`docs/customizations/bistro-create-blog-orbitype.md`).
  Migration: `0024_create_blog_orbitype_capability.sql` — run `pnpm db:migrate`
  before dashboard assignment.

### new-stack skill and enrollment runbook

- Agent skill `.cursor/skills/new-stack/`: preparation-only gate for new
  project profiles / stacks (interview, impact, approval STOP, spec/ADR/docs,
  readiness handoff). Does not implement product code.
- Operator runbook `docs/ENROLLMENT.md`: enroll a client on an active stack
  vs first client after a newly implemented stack.

### Enrollment Telegram runtime hot-load

- Local worker reconciles active Telegram admin/client credentials on each
  heartbeat, not only at process start, so a newly verified client bot can
  receive `/start <token>` and activate the enrollment without a worker
  restart.
- Enrollment dashboard mutations refresh and retry once on `409` stale
  `If-Match` (version advanced by validate/pairing) instead of leaving the
  operator on a stuck conflict.

### Selectable monolingual locales (ADR-0046)

- Platform content locales remain exactly English, Spanish and German.
  Enrollments may enable any non-empty subset, including monolingual (for
  example German-only). New translation policy `none` is required when only one
  content locale is enabled. Webbin/`astro_repo` pilot overlay stays bilingual
  `es`+`en` with `always_translate`. Dashboard locale fields are editable for
  non-Webbin profiles.

### Astro+Orbitype enrollment (ADR-0045)

- Post-MVP profile `astro_orbitype` / stack `astro-orbitype`: dashboard
  enrollment with Orbitype API-key verification, Telegram client pairing, and
  activation with an empty capability catalog. Spec:
  `docs/specs/astro-orbitype-enrollment.md`. Does not change `astro_repo` tools.
- Implementation: selectable `projectProfile` on create enrollment; credential
  kind `orbitype-api` with read-only `SELECT 1` verify; GitHub/Vercel bindings
  allowed for `astro_orbitype` projects with explicit repository/branch;
  package `@binflow/orbitype`; empty capability catalog valid for activation.
- Fix: credential verification no longer requires GitHub/Vercel connections to
  be the Webbin pilot keys when the bound project profile is `astro_orbitype`.

### Tool catalog stack path unification

- Moved `delete_project` from mistaken `packages/tools/stacks/astro_repo/` into
  `packages/tools/stacks/astro-repo/` so the dashboard shows one Astro stack.
  Project profile remains `astro_repo`. Graph version is now
  `stacks/astro-repo/delete-project@1`.

### Dark control-plane design system (ADR-0044)

- Dashboard adopts a dark-only sidebar shell and documented tokens in
  `docs/DESIGN-SYSTEM.md` (Nuxt UI + Binflow CSS variables).
- Top-bar Tools/System dropdowns become direct sidebar links.
- Auth pages (login, two-factor, security) share the dark centered card pattern.
- Requests inbox restores semantic status badges and approval card tints on the
  dark surface (emerald / rose) without a surface class overriding the tint.
- Requests inbox cards use Figma state accents (left border + matching badge):
  completed green, in-progress blue, awaiting/revision amber, cancelled grey,
  failed rose — instead of full-card approval fills.
- Home shows a local `dd-mm-yy` + 24-hour clock chip above **Add client**.

### new-feature agent skill (governance gate)

- Project skill `.cursor/skills/new-feature/`: interview → classify → impact
  matrix (docs/ADR/tools) → approval STOP on rule changes → write
  `docs/specs/` + ADRs/changelog → handoff to create-tool or impl plan.
  Does not implement product code. Linked from DEVELOPMENT and create-tool.

### Admin→client Telegram direct messages (ADR-0043)

- Dashboard Message modal (Home client cards; request detail only after
  `admin_rejected`) queues bounded freeform text to the paired client Telegram
  conversation via `client.notification_requested`.
- New routes: enrollment message-target + messages; request message-target +
  messages.
- Reject/approve remain independent of messaging.

### Requests inbox stacked layout and approval tones

- Requests page stacks **Needs admin approval** above **Requests** (no longer
  side-by-side columns).
- Request summaries expose nullable `approvalStatus` from `terminalResult`.
  Lower-section cards use emerald / rose surface tones after admin approval or
  rejection (dark control-plane palette).
- Approval queue no longer shows a “Next approval batch” control; the Requests
  section paginates with **Previous requests batch** and **Next requests batch**.

### Dashboard navigation and tools catalog UX

- Home client cards open enrollment via a top-right settings (cog) control
  instead of an “Open enrollment” button.
- Tools catalog supports search, stack filter (available stacks), and sort.
- Integrations list supports search, client filter (tenant binding or
  Platform), and sort.
- AppShell: Customizations lives under the Tools dropdown (Catalog ·
  Customizations). System menu is Integrations · Operations only (Security
  remains auth-gated, not listed in the shell).

### Dashboard home and persistent navigation

- Authenticated pages share `AppShell`: primary (Home, Clients, Requests),
  Tools menu (Catalog, Customizations), and a System menu (Integrations,
  Operations). Login, two-factor, and Security keep the auth layout.
- Home (`/`) is an operations cockpit: system health/readiness, requests today
  and pending approvals (from recent request batches), client mix, client
  summary cards, and a needs-attention list. Client cards deep-link to
  `/requests?projectId=…`.
- Per-page duplicate headers removed; page bodies keep local actions (Refresh,
  Add client, back links).

### Tool isolation and shared catalog ports (ADR-0042)

- `createGitHubContentCatalogPort` requires explicit non-empty `contentKinds`
  (no blog+portfolio default).
- Worker uses `createCapabilityCatalogPort` / `catalogContentKindsForRuntimeKind`
  so blog and delete-blog sync blog only; project and delete-project sync
  portfolio only (unchanged scopes vs prior hotfix).
- `catalog_sync` nodes declare `parameters.catalogScope`; capability conformance
  asserts alignment with runtime kind.
- create-tool / test-tool skills document shared-port scope creep.

### Admin notification exactly-once delivery

- Outbox drain for admin/client notices (and workflow resume) claims each
  pending row with an `available_at` lease before Telegram/`queue.add` side
  effects. Concurrent workers no longer deliver the same
  `admin_approval_required` (or other) notice three times when more than one
  worker process is running.

### Delete project client Telegram copy

- Admin-pending and completion notices accept `contentKind: 'blog' | 'portfolio'`.
  Delete project uses portfolio wording (*proyecto*); delete blog keeps *artículo*.

### Delete project local enablement

- Migration journal entries for `0020` and `0023` restored; `0023` registers
  `delete_project_astro@2`.
- Operator script: `packages/tools/scripts/add-webbin-delete-project-binding.ts`.

### GitHub catalog sync scoped by tool content kind

- `createGitHubContentCatalogPort` requires non-empty `contentKinds` (`blog` |
  `portfolio`). Create/delete blog sync blog directories only; create/delete
  project sync portfolio only. Fail-closed replaces the former optional dual
  default (ADR-0042).

### Workflow worker stuck-state recovery

- Worker promotes `QUEUED` / `GENERATING` / `FAILED_RETRYABLE` requests to a
  terminal or retryable failure when BullMQ jobs fail (including immediate
  `UnrecoverableError`), re-enqueues stale `QUEUED` and interrupted `GENERATING`
  executions, and configures BullMQ stall detection.
- Workflow runtimes allow `GENERATING` at execute entry so interrupted jobs can
  resume instead of failing as "not executable".

### Delete portfolio project (`delete_project_astro@2`)

- New destructive capability mirroring `delete_blog_draft@2`: title/URL input,
  live portfolio catalog sync at ingress, deletion PR without preview, admin-only
  approval (`webbin-project-deletion@1`), production 404 verification with polling.
- Telegram: `/delete_project` + natural language (delete verb + portfolio cues);
  NL dispatch ordered before create-project intent.
- Executor: `DeleteProjectExecutor` in `@binflow/projects`; runtime
  `DeleteProjectWorkflowRuntime`; migration `0023_delete_project_astro_capability.sql`.
- Default `astro_repo` bindings include `delete_project_astro@2`.
- Spec: `docs/specs/delete-project.md`; ADR-0040 consequences updated.

### Delete blog: defer post-deletion redirects (ADR-0041)

- Deletion PRs remove manifest-declared content paths only; they no longer upsert
  `public/_redirects`.
- `verify_production` uses `DeploymentPort.verifyAbsence` — deleted article routes
  must return HTTP 404 in production. Redirect management waits until the client
  repo supports Vercel-native redirects.

### Delete blog: live catalog sync at ingress

- Delete requests sync the content catalog from GitHub before resolving title/URL
  targets. Stale DB rows no longer cause false `article_not_found` or false positives
  for already-removed articles.
- Title matching accepts any blog locale; URL/slug resolution uses the fresh catalog
  snapshot.

### Delete blog: poll production 404 verification

- `verifyAbsence` polls deleted routes until they return HTTP 404 instead of checking
  once right after the Vercel deploy becomes READY (CDN propagation lag caused false
  `route_still_live` failures after successful merges).

### test-tool skill (client-realistic audit)

- New skill `.cursor/skills/test-tool/` for post-ship audits: scenario matrix by
  mutation class, automated baseline, optional live Telegram playbook, audit
  reports in `docs/audits/`.
- Documented in ADR-0039 §6, `docs/TESTING.md`, `docs/audits/README.md`.
- Pilot audit: `docs/audits/delete_blog_draft-webbin-2026-08-28.md`.

### Delete blog: redirects to site home (GSC)

- Deleted article routes upsert `public/_redirects` with destination `/` (site
  home) instead of portfolio paths. All blog locales redirect to the same root
  URL so Search Console does not keep removed URLs as orphan issues.
- `verifyDeletionRedirects` accepts apex and `www` hostnames and validates
  pathname `/` for home targets (ADR-0040 amended).

### Delete blog: merge without preview commit-status gate

- Deletion PR revalidation no longer requires GitHub combined commit status
  `success`. Admin approval binds to the PR head (no `wait_preview`); requiring
  Vercel preview checks caused merge to fail when approval landed before the
  preview finished, leaving the request stuck in `REVALIDATING`.
- Delete publish failures now leave `REVALIDATING` and set
  `FAILED_RETRYABLE` / `FAILED_FINAL` with terminal error detail (aligned with
  create-blog).

### Delete blog: open_deletion_pr GitHub upsert fix

- `createDraft` now supplies the current blob `sha` when updating an existing
  path (e.g. `public/_redirects` already on `main`). Without it, GitHub
  returned 422 and delete-blog aborted at `open_deletion_pr` with
  `provider_final`.
- Optional deletion paths that are absent on the branch (cover `.avif`,
  missing locale) are skipped; only existing content files are required.
- Delete executor persists the filtered deletion set so PR file checks stay
  consistent.

### GitHub token cleanup no longer fails successful operations

- Repository publication and catalog ports ignore installation-token
  `DELETE` failures when the primary GitHub operation already succeeded.
  Fixes delete-blog execute aborting at `validate_deletion` with
  `GitHub publication token cleanup failed` and `FAILED_FINAL`.
- Delete-blog workflow `recordFailure` now marks `provider_retryable` errors
  as `FAILED_RETRYABLE` (aligned with create-blog runtime) so BullMQ retries
  can resume instead of wedging the request in `FAILED_FINAL`.

### Delete blog: existence gate and admin-pending UX

- Resolve delete targets only against **published** catalog items; URL path no
  longer accepts orphan slugs. Executor `validate_deletion` verifies content
  files still exist on production branch before opening PR.
- Re-delete of removed articles aborts with `article_not_found` and clear
  Telegram copy (`FAILED_FINAL` when a collection request already exists).
- After deletion PR opens: client gets **text-only** admin-pending notice (no
  GitHub PR preview buttons, no Cancel). Completion notice is text-only as well.
- Requests stuck in `REVALIDATING` from invalid re-delete: cancel or fail in
  dashboard (no auto-heal in this release).

### Create-tool skill: inline CTA rules

- `client-facing-copy.md` — decision-surface matrix (plan, URL confirm, preview,
  revision, cancel); action token vs label; `*ActionLabels` pattern; delete_blog
  and create_blog reference tables.
- Interview Phase 4b, checklist layer 17, spec template § Inline CTAs, SKILL.md
  Never, layers antipattern #11.
- Skill also documents catalog version resolution: never hardcode
  `capabilityVersion: 1` / `graphVersionForCapability(..., 1)` after bumps
  (`post-ship-ops.md` §7, layers antipattern #12).

### Graph version resolves latest catalog tool

- `graphVersionForCapability` no longer defaults to capability version `1`
  (ADR-0038: omit version → latest). Fixes `Unknown tool delete_blog_draft@1`
  after bumping the catalog to `@2`. Delete-blog request versions store
  `deleteBlogDraftDefinition.version`.

### Delete blog plan CTA labels

- Plan confirm and URL-confirm inline buttons for `delete_blog` use
  delete-specific labels (`Borrar artículo` / `Delete post`, `Sí, es este` /
  `Yes, this one`) instead of the create-flow `Crear borrador` / `Create draft`
  copy. Actions remain `confirm_plan` / `confirm_delete_target` tokens.

### Create-tool skill hardening (ADR-0039)

- `.cursor/skills/create-tool/` — new references: `client-facing-copy.md`,
  `graph-by-mutation.md`, `post-ship-ops.md`; interview Phase 4b (copy) and
  expanded NL ingress / graph phases; checklist layers 13–16; spec template
  sections for client messages, graph semantics, stack rollout.
- `scaffold-tool.ts` — rejects destructive briefs with `create_draft` /
  `wait_preview`; stack rollout checklist + `astro_repo` default binding snippet;
  mutation-aware ADR/spec sections.
- `delete_project_astro.brief.yaml` — documented anti-pattern until graph rewrite.

### Capability assignment profile gate

- `PUT /api/v1/projects/:projectId/capabilities` rejects tools whose
  `allowed_profiles` does not include the project’s profile
  (`capability_profile_incompatible`).
- Enrollment responses include `projectProfile`; Tools detail assignment lists
  only compatible clients and surfaces API error messages.
- `delete_blog_draft@1` requires `pnpm db:migrate` (migration `0021`) before
  dashboard assignment.

### Delete blog capability (`delete_blog_draft@1`)

- ADR-0040 accepted for destructive content: GitHub file DELETE in deletion PRs,
  catalog tombstone, admin-only deletion policy.
- Tool catalog: `packages/tools/stacks/astro-repo/delete-blog/` with manifest-driven
  deletion scope (locales/paths from enrollment manifest, not hardcoded bilingual).
- Telegram: `/delete_blog` + natural language; title/URL collection via Webbin
  customization `content_schema`; URL confirm when entering by title only; admin-only
  merge approval.
- Dashboard → Customizations: `delete_blog_draft` appears in tool dropdown; Webbin
  pilot customization uploaded via
  `scripts/upload-webbin-delete-blog-customization.ts` and
  `docs/customizations/webbin-delete-blog-draft.md`.

### Delete blog UX and graph coherence

- Natural language: conjugated delete verbs (`borra`, `elimina`, …) route to
  `delete_blog_draft` before `create_blog`.
- Plan confirm shows title + URL only; admin notices include client, action, PR,
  and request id.
- Delete graph uses dedicated `open_deletion_pr` (`blog.open_deletion_pr@1`) instead
  of reusing `create_draft`; `wait_preview` removed; `requiresPreview: false`.
- Deletion PR upserts `public/_redirects`; production verify expects 301/308 to
  portfolio routes (ADR-0040 amended).
- Migration `0022_delete_blog_no_preview` registers `delete_blog_draft@2` with
  `requires_preview = false` (append-only; v1 row unchanged). Rematerialize Webbin
  after deploy:
  `pnpm --filter @binflow/tools exec tsx scripts/refresh-webbin-manifest-redirects-path.ts`.

### Tool authoring pipeline (ADR-0039)

- `.cursor/skills/create-tool/` — phased human-in-the-loop interview, layer
  checklist, spec/ADR templates.
- `packages/tools/briefs/*.brief.yaml` + `packages/tools/src/tool-brief.ts` (Zod).
- `pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts` generates
  catalog files, migration SQL, spec, and ADR draft; prints manual registry snippets.
- Dry-run artifacts for `delete_project_astro`: brief, `docs/specs/delete-project.md`,
  ADR-0040 (Proposed) listing platform gaps — not registered in catalog.

### Capability runtime registry (ADR-0038)

- Graph versions for queued runs resolve from `tool.yaml` via `getTool` (fixes
  stale `create-project@3` hardcode).
- `packages/workflows/src/capability-runtimes.ts` maps `executorId` → runtime
  kind (fail-closed; no blog fallback for unknown capabilities).
- OpenAI generation ports and workflow runtimes parameterize `capabilityId`.
- Telegram slash dispatch uses `capabilityIngressRoutes` from `capabilityRegistry`.
- Conformance suite: `packages/workflows/test/capability-conformance.test.ts`.

### Portfolio rail metadata + cover path hardening

- Collection heuristics close only the currently asked customization field and
  reject URL-like values for `string` / `stringList` (so answering `url` no
  longer poisons `stack`, `clienteTipo`, or `industria`).
- Merge ignores URL-poisoned stack/business facts; `rol` always includes base
  Desarrollo / Development when role flags are present.
- Provided hero covers always force frontmatter `imagen` to the AVIF public path
  (overwriting LLM `.jpg` paths).
- Webbin `create_project_astro` customization clarifies stack ask with real tech
  examples; re-upload required via
  `pnpm --filter @binflow/tools exec tsx scripts/upload-webbin-project-customization.ts`.

### Project year-month, URL evidence, AVIF covers (ADR-0037)

- Base closed facts now use `projectDescription` (NL) and `fecha` as `YYYY-MM`
  (normalized to `YYYY-MM-01` at render). DSL adds `yearMonth`.
- Graph `stacks/astro-repo/create-project@4` adds `read_project_url` after
  similarity (HTTP fetch + typed LLM extract; no Playwright). Fetch is
  best-effort: browser-like UA + title/og meta extraction; if the page cannot
  be read but `projectDescription` is present, generation continues without
  `urlEvidence` instead of failing the request.
- Portfolio covers re-encode to AVIF (`/images/projects/{slug}.avif`).
  Manifest `editablePaths` allow both `*.jpg` and `*.avif`; path patterns are
  part of the manifest fingerprint. Existing Webbin enrollments need a forced
  rematerialize after this change:
  `pnpm --filter @binflow/tools exec tsx scripts/refresh-webbin-manifest-avif-paths.ts`.
- Telegram slash commands persist photo attachments; photo-only messages no
  longer poison open string facts with `[image]`.
- Collection asks base `projectDescription` explicitly (heuristics no longer
  close it from answers to other fields).
- Deterministic merge applies closed-fact metadata (`clienteTipo`, `industria`,
  `impacto`, `stack`, `rol`, `destacada`, …) onto `project_bundle.v1` after
  generate.
- Webbin customization rewritten for role booleans, business-type `clienteTipo`,
  optional highlight, and URL-grounded sections; re-upload required.

### Portfolio hero screenshot cover (ADR-0036)

- `create_project_astro` graph is now `stacks/astro-repo/create-project@3` and
  no longer includes AI `prepare_image` cover generation.
- Webbin customization requires public `url` and `heroScreenshot` (`type: image`).
- Telegram photo attachments during `NEEDS_INPUT` persist to the artifact store
  and close `image` content-schema fields; covers render from that screenshot.
- Content-schema allowlist adds `image` field type (artifact key, not model pixels).

### Project content-schema DSL and collection loop

- `create_project_astro` collects minimal closed facts (`name`, `fecha`,
  `description`, optional `category`/`images`) in `NEEDS_INPUT` before plan
  confirmation (ADR-0035). Customization may declare extra fields via allowlisted
  `## content_schema` YAML; Zod decides when facts are closed.
- Webbin customization (`docs/customizations/webbin-create-project-astro.md`) now
  includes rich portfolio fields plus editorial sections for dashboard upload
  (`pnpm --filter @binflow/tools exec tsx scripts/upload-webbin-project-customization.ts`).
- ADR-0030/0034 amended: customization may add content fields, not models/paths
  or approvals.
- Input mode `collect` added to `createProjectAstroInputSchema`; brief mode may
  carry `closedFacts` into generation.

### Dashboard tool assignment

- Operators can assign code-owned tools to validated clients from the client
  detail page or the tool graph page. Assignments persist through immutable
  manifest revisions and update `project_capability_bindings`.
- `PUT /api/v1/projects/:projectId/capabilities` accepts `{ bindings: CapabilityBinding[] }`.
- `GET /api/v1/tools/:toolId/assignments` lists clients with the tool on their
  latest manifest.
- Assigning a tool whose row is missing from `capability_definitions` now returns
  `400` with `capability_definition_missing` instead of `500` (run
  `pnpm db:migrate` first). Active manifest revisions are superseded when
  bindings change.
- Telegram client bot routes conversational portfolio briefs to
  `create_project_astro` (keywords or brief cues) in addition to
  `/create_project <brief>`.
- Failed workflow requests no longer return `400` on
  `GET /api/v1/requests/:id` when `terminalResult` omits optional execution
  fields such as `destacada` (`parseRequestExecution` in `@binflow/contracts`).
- OpenAI project generation uses `generatedProjectBundleModelSchema` with
  nullable optional fields (`imagen`, `url`) so structured output validation
  succeeds at the provider. Model `url` is a plain string (not JSON Schema
  `format: uri`, which OpenAI rejects); domain validation runs in
  `normalizeProjectBundleFromModel`.
- Project generation binds `tipo` and `estado` to manifest `enumFields` in the
  OpenAI schema and normalizes accent or casing drift in
  `normalizeProjectBundleForManifest` before `validate_project_bundle`.

### Create project astro portfolio capability

- Renamed stack capability to **`create_project_astro@1`** with graph
  `stacks/astro-repo/create-project@2`, manifest-driven portfolio structure, and
  DB-only customization loading (ADR-0034 supersedes ADR-0033).
- Extended `content.portfolio` with `sectionHeadings`, `enumFields`, and
  `requiredFrontmatter`; `@binflow/projects` renderer and validators read manifest
  values instead of Webbin-hardcoded headings.
- Added validation stages (`normalize_project_bundle`, `validate_project_bundle`,
  `validate_privacy_and_evidence`, `repo_contract_checks`), `publicationIntent`,
  `image.mode`, and `project_bundle.v1` envelope.
- Webbin editorial deliverable:
  `docs/customizations/webbin-create-project-astro.md` for dashboard upload.
- Migration `0020_create_project_astro_capability.sql` registers the new capability id.

### Create project draft portfolio capability (superseded)

- Added `create_project_draft@1` for bilingual Astro portfolio case studies
  (`/create_project`) with `project_bundle` → Markdown → preview PR pipeline
  (ADR-0033, superseded by ADR-0034).

### Preview wait resilience and MD pipeline clarity

- Vercel `waitForPreview` / `waitForProduction` keep polling through transient
  network and 5xx/429 failures until the deadline; only auth, policy, ERROR, or
  invalid evidence abort early.
- Durable `requests.state` moves to `PREVIEW_DEPLOYING` on `create_draft` /
  `wait_preview` stages (not only checkpoint metadata).
- Surgical revision persist updates the existing GitHub PR row when the provider
  pull id already exists, so a successful preview wait is not blocked by the
  unique provider-id constraint.
- Draft updates that do not produce a new GitHub commit (identical files) fail
  closed instead of rebinding the previous preview head.
- Documented content pipeline: validated `blog_bundle` → rendered Markdown →
  GitHub draft → SHA-bound preview. Markdown is an artifact, not the revision
  source of truth.

### Revision plan Structured Outputs schema

- `interpret_revision` uses an OpenAI-compatible model schema where optional
  fields are `.nullable()` (required keys), then normalized into the domain
  `RevisionPlan`. Invalid Structured Outputs schemas fail as `provider_final`
  without opaque retries.

### Tools graph flowchart

- The dashboard tool detail view renders nodes as a connected top-to-bottom
  flowchart. Conditional `when` edges are dashed with predicate labels; the
  detail panel for rules/model is unchanged.
- The flowchart fills the panel width without horizontal overflow, grows
  vertically with the graph, fans multi-edge ports, and routes cycle edges
  outside the main spine for clearer connections.
- Branching nodes place each forward successor on a distinct horizontal column
  so parallel and revision paths do not stack on one vertical corridor.

### Flexible surgical revision interpret + retry UX

- `interpret_revision` receives the prior article body and metadata (not only
  titles) so magnitude classification covers word/paragraph add/edit/delete.
  Schema-invalid model plans become `provider_final` instead of opaque
  `provider_retryable` loops. Dashboard distinguishes `FAILED_RETRYABLE`
  (retrying) from `FAILED_FINAL`; exhausted BullMQ attempts promote to final.

### Surgical blog revision with confirmed plan (ADR-0032)

- Post-preview revisions no longer re-run full generate by default. Feedback
  produces a structured `RevisionPlan` with a code-owned magnitude; the client
  confirms, adjusts, or cancels in `AWAITING_REVISION_PLAN_CONFIRMATION`.
- Surgical magnitudes reuse the persisted `blog_bundle` artifact and prior cover
  image when possible; `full_regenerate` still regenerates content and image.
- Free-text after **Request changes** counts as feedback; GitHub draft update
  rewrites the existing branch when the slug is preserved.
- Migration `0018_awaiting_revision_plan_confirmation` adds the new request
  state enum value.

### Context-first blog brief (ADR-0031)

- Long `/create_blog` or natural-language briefs are no longer word-boundary
  truncated into `topic`. Messages ≤500 characters remain topic-only; longer
  messages (≤10 000) store the full text in `context` with a localized
  provisional topic. Execution adds `interpret_brief` before similarity so the
  LLM proposes the durable topic; the client brief is never sliced to fit 500
  characters.

### Host `dev:live` enables blog execution

- Plain `pnpm run dev` still defaults `BINFLOW_LIVE_EXECUTION_ENABLED` off, so
  confirmed plans remain `QUEUED` until the kill switch is on. `pnpm run
  dev:live` starts the same Turbo stack with the switch enabled; the worker
  logs whether live execution is on at startup.
- Execute advances the graph run to `catalog_sync` before loading project tool
  customizations, so bootstrap SQL/config failures no longer report
  `failedNode: plan_confirmed`.

### Long Telegram blog briefs map to topic + context

- A natural-language or `/create_blog` message longer than 500 characters no
  longer fails Zod validation silently. **Superseded by ADR-0031:** ingress
  stores the full message in `context` with a provisional topic instead of
  truncating into `topic`.

### Declarative tools catalog and client customization

- Added ADR-0030. Tools live under `@binflow/tools` grouped by stack, with
  per-node `node.yaml` / `rules.md`, shared rule documents, and a downloadable
  customization template. One tool binds to one stack; shared value is at the
  node/rule layer.
- Amended ADR-0004: the workflow runtime is TypeScript-owned with BullMQ
  transport; LangGraph is not a dependency. Checkpoints are append-only stage
  logs; retryable failures re-enter the resume command.
- Plan node names and WORKFLOWS mermaid align with executor checkpoints
  (`similarity`, `category_decision`, `generate`, …). Graph version stamp is
  `stacks/astro-repo/create-blog@1`.
- Dashboard Tools and Customizations surfaces visualize graphs and manage
  per-client markdown style documents. Uploaded customization cannot set model,
  effort, paths or approvals.
- Skills `create-tool` and `edit-node-config` edit the repository catalog.
- Capability assignment, Telegram catalog-driven `/tools` and `setMyCommands`
  follow the multi-binding project path.

### Client notice on dashboard cancellation

- Added ADR-0027. Cancelling a request from the dashboard previously changed
  state and wrote an audit event without telling anyone, and no transport existed
  for an API-initiated transition to reach a client conversation.
- Added the durable `client.notification_requested` outbox event type, drained by
  the worker to the requesting client's Telegram conversation with the same
  bounded backoff and dead-lettering as admin notifications. Payloads never carry
  a destination chat ID; the worker resolves it from the paired channel identity.
- Dashboard cancellation now enqueues one such event in the transaction that
  commits the terminal state, rendered in the conversation locale. The copy is
  neutral and unattributed. Cancellation still produces no admin notification,
  client-initiated `/cancel` still answers in-thread only, and approve, reject
  and revise still do not notify the client.

### Local Telegram polling exclusivity

- The worker acquires a Redis lock per Telegram bot before starting long polling.
  A second worker (Compose + host `pnpm dev`, or a stale `tsx watch` process)
  starts in **send-only** mode: it can still deliver outbound notices but does
  not call `getUpdates`, avoiding
  `Conflict: terminated by other getUpdates request`.
- Prefer one active poller in local dev. When using host `pnpm dev`, stop the
  Compose worker with
  `docker compose -f infra/compose/local.yml stop worker`.

### Request inbox by client

- The dashboard requests page is a two-column inbox: admin-approval queue on
  the left, all other states on the right. A shared All / active-client filter
  applies to both columns. Page size is 10, 30 or 50 with a per-column next
  batch via cursor. A vertical divider separates the columns on large screens.
  The client filter lists operational enrollments plus clients present in the
  loaded batches (e.g. Webbin), using display names when available. **Open
  request** navigates to `/requests/:id` with a full document load, so the
  detail page shows only that request and its admin actions (approve, request
  revision, cancel while non-terminal).
- `RequestSummary` and `RequestDetail` include `clientName` and `clientKey`.
  Detail renders interpreted input and plan as labeled fields.
- Fixed two client-side regressions in that inbox. The **All** filter option now
  carries an `all-clients` sentinel value because select items reject the empty
  string, which had crashed the inbox on return navigation. Bounded refresh now
  receives timer callbacks bound to the global object, so opening a non-terminal
  request no longer fails with `Illegal invocation` and the **Cancel request**
  action renders.

### Request stage log and admin failure alert

- Confirmed ADR-0023 decision 3: `request.failed_final` (and `request.published`
  when production is verified) are durable admin-notification outbox events.
- Blog execution records append-only workflow checkpoints at each executor stage
  (`catalog_sync`, `generate`, `prepare_image`, `render_artifacts`,
  `create_draft`, `wait_preview`). `FAILED_FINAL` persists `errorMessage` and
  `failedNode` and enqueues an admin Telegram notification.
- `RequestDetail` exposes redacted `stages` and `failure`. The dashboard request
  page shows a failure banner, stage log and bounded refresh for non-terminal
  states.

### Telegram buttons on every client action

- Accepted ADR-0026 as applying to every token-bearing client notice, not only
  the first Chat reply. Plan, preview, revision and cancel controls are inline
  buttons. Visible copy never includes `/action <token>`. Publication-complete
  messages use live-origin URL buttons (ADR-0029).

### Live production origin

- Accepted ADR-0029. Client-visible production URLs use
  `https://webbin.com.mx`. Unique `*.vercel.app` deployment hostnames and
  `webbin.dev` are never presented as the live site.

### English titles and headings

- Confirmed ADR-0011. The English article’s `titulo`, `seoTitulo`, description,
  alt text, FAQ questions and Markdown headings must be idiomatic English.
  Copying the Spanish strings into `src/content/articulos/` fails validation.

### Idempotent publication after merge

- Accepted ADR-0028. A GitHub merge that succeeds must not strand the request
  as `FAILED_FINAL` because production URL selection ignored custom domains
  assigned to `main`, because the domain list was empty, or because resume
  required the PR to still be open. Publication records the merge commit
  before waiting for production. Client-visible URLs follow ADR-0029.

### Telegram inline action buttons

- Client plan and preview decisions are Telegram inline buttons. Callback
  queries use the clicking user and the opaque token; typed `/action` remains
  a fallback. Preview notices add Spanish/English URL buttons. Binflow does
  not mint Vercel shareable links; public preview access is a Vercel project
  Deployment Protection setting (ADR-0026).

### Production publication URLs

- Telegram "publication complete" messages and stored production evidence use
  `https://webbin.com.mx` (ADR-0029). Preview remains the unique Vercel
  deployment origin.

### Approved preview publication resume

- GitHub PR revalidation before merge is a successful void operation. Treating
  that void result as missing publication output marked an approved preview
  `FAILED_FINAL` without merging. Publication now records the provider error
  message and resumes unmerged `internal_error` attempts by re-reading PR state.

### Dashboard local-dev session render

- Document rendering reads the owner session in-process from the request cookie
  so `/login` cannot deadlock on a nested `/api/auth` fetch. Missing, failed or
  incomplete session objects stay unauthenticated instead of throwing
  `Cannot read properties of undefined (reading 'session')`.
- Host `pnpm dev` loads the default Better Auth secret file when the Compose
  secret path is unset, and still requires local PostgreSQL/Redis from Compose.
- The idle-session browser timer calls `setTimeout`/`clearTimeout` as methods
  so a logged-in dashboard load cannot throw `Illegal invocation`.

### Rolling owner sessions and client-pairing completion

- Accepted ADR-0024, replacing the 12-hour/five-minute split with one rolling
  30-minute inactivity boundary enforced by Better Auth and the dashboard.
- Accepted ADR-0025, making successful Telegram pairing-response delivery the
  idempotent transition from `pairing_pending` to `active`; request-bound
  catalog/GitHub/Vercel checks remain fail-closed before publication.
- Defined restored-navigation revalidation, no-store dashboard documents,
  bounded pending-pairing refresh and delivery-ordered activation evidence.

### Authentication and Telegram pairing reliability

- Defined post-TOTP navigation as a server-session revalidation plus document
  replacement so a stale anonymous Nuxt payload cannot return the owner to the
  login screen.
- Defined explicit Chat SDK slash-command dispatch for Telegram so `/start`
  pairing reaches the same authorized ingress service as ordinary direct
  messages and always produces a deterministic reply.
- Fixed the dashboard login challenge to bypass stale anonymous session payloads
  after TOTP and fixed both Telegram runtimes to register command and direct
  message ingress, with regression coverage for redirect safety and admin
  `/start <token>` preservation.
- Confirmed ADR-0016 and ADR-0023 unchanged; this corrects implementation drift
  without changing session assurance or pairing authority.

### Dashboard contrast correction

- Fixed the dashboard semantic action-color mapping so solid buttons retain a
  visible palette background behind white text, with a regression test for the
  generated Nuxt UI token contract.

### Module 9 production readiness

- Accepted ADR-0023 for secure admin-bot pairing, durable operational
  notifications, readiness, reconciliation and the fail-closed contract for a
  later VPS webhook cutover.
- Added the Operations pairing screen, durable admin notifications, service
  heartbeat readiness and a one-shot safe maintenance reconciler.
- Made Docker Desktop's owner-only Compose secret mount compatible with the
  runtime KEK guard while still requiring the mount itself to prove read-only.

### Module 8 complete blog capability

- Accepted ADR-0022 for deterministic bilingual generation, artifact storage,
  exact GitHub/Vercel preview binding and approval-gated publication.
- Added the Module 8 data, provider-port, approval and operational contracts
  before implementation.
- Implemented strict OpenAI bilingual generation and image accounting, GitHub
  catalog/PR/check/merge operations, Vercel SHA-correlated preview/production
  evidence, S3-compatible artifacts and the exact approval/revision loop.
- Added embedding-backed catalog similarity with durable catalog, decision and
  ranked-candidate evidence under tenant RLS.

### Added

- Established the documentation-first repository baseline.
- Defined the product, MVP, architecture, contracts, workflow, security, data, Telegram, integrations, testing, operations and phased roadmap.
- Recorded the initial architectural decisions and documentation Definition of Done.
- Fixed Node.js 24 LTS as the Phase 0 implementation baseline.
- Defined the Phase 0 interactive credential CLI and envelope-encrypted SecretsProvider contract.
- Added ADR-0013 for the explicitly approved GitHub App administrative registration ceiling, Webbin-only installation and per-operation token downscoping.
- Added ADR-0014 defining platform/tenant/project credential ownership, public configuration versus encrypted bundles, candidate activation/rollback and read-only provider verification.
- Added an integration application-service boundary so the CLI and later dashboard share credential verification and lifecycle behavior.
- Required Docker packaging from Phase 0 with shared local/VPS-ready application images.
- Added the Phase 0 draft scope bootstrap contract required before encrypted credentials can be tenant/project scoped.
- Added the executable TypeScript monorepo, CI skeleton, API health endpoint, worker/maintenance shells, Nuxt dashboard shell and local/production Docker definitions.
- Added the first shared domain/contracts packages and authenticated AES-256-GCM envelope implementation.
- Added initial PostgreSQL migrations, UUIDv7 records, tenant RLS policies, encrypted credential lifecycle storage and the Phase 0 scope/credential CLI commands.
- Added read-only Phase 0 credential verification for OpenAI model visibility, Telegram bot identity/transport and the Webbin-only GitHub App installation, including candidate activation and rollback tests against isolated PostgreSQL.
- Added read-only Vercel identity/project verification for the exact Webbin GitHub link and production branch.
- Added secure interactive GitHub PEM file import with repository-boundary, regular-file, size and `0600` permission checks.
- Added the Chat SDK Telegram/Redis runtime boundary and an in-memory messaging fake without enabling real bot handlers.
- Runtime containers execute compiled Node entrypoints as a non-root user and do not invoke package managers at startup.
- Added ADR-0015 and the Phase 1 control-plane foundation contracts for
  same-origin auth/business ingress, explicit database scopes, optimistic
  concurrency, durable idempotency, administrative operations and transactional
  outbox delivery.
- Serialized concurrent schema migration runners with a PostgreSQL advisory lock.
- Added ADR-0016 and the documented administrative authentication contract:
  single-owner interactive bootstrap, disabled public sign-up, mandatory TOTP,
  single-use backup codes, database-backed rate limits and fresh-session gates.
- Removed top-level await from the migration executable so the shared database
  package remains bundle-safe for the Nuxt authentication server runtime.
- Added the Better Auth server runtime, sole-owner CLI bootstrap, Nuxt login,
  TOTP enrollment/challenge, one-time backup-code display, session management
  and the authenticated Fastify session bridge.
- Revoked all dormant password-only sessions when initial TOTP enrollment
  completes so they cannot inherit two-factor assurance retroactively.
- Serialized root workspace test tasks that share the disposable PostgreSQL
  database, preventing cross-package fixture cleanup races.
- Aligned the Nuxt server bundle target with the pinned Node.js 24 runtime so
  modern dependency syntax is preserved without an incompatible ES2019 pass.
- Added dashboard/auth readiness checks and made the production Caddy service
  wait for a healthy dashboard rather than only a started process.
- Added ADR-0017 and the strict resumable enrollment/activation-evidence
  contract, including Phase 0 scope adoption, fail-closed mutable validations
  and hash-only one-time pairing links.
- Added the enrollment database aggregate, immutable dependency-fingerprinted
  validation attempts, pairing-token hashes, transactional audit/outbox events
  and tenant/project constraints in migration `0009`.
- Added the authenticated enrollment API and English dashboard screens for
  client creation, resumable configuration, credential readiness validation
  and one-time Telegram pairing-link delivery.
- Added redacted pairing idempotency receipts so retries never persist or
  redisplay the one-time plaintext token.
- Included the onboarding workspace in the shared Docker dependency layer so
  the same application image builds locally and for the future VPS release.
- Added ADR-0018 for one-time dashboard credential enrollment, API-only runtime
  KEK access, keyed secret idempotency and optimistic credential revisions.
- Added the authenticated integrations dashboard and API for redacted credential
  inventory, strict one-time provider enrollment, candidate verification and
  explicit revocation. Migration `0010` adds optimistic credential revisions.
- Added the `integration-admin` application service so CLI and dashboard reuse
  the same encrypted lifecycle and provider verifiers without exposing provider
  evidence or configuration to the browser; the shared Docker dependency stage
  includes the new workspace.
- Added Docker/runtime KEK loading that preserves host `0600` enforcement while
  accepting only the read-only permission modes used by `/run/secrets` mounts.
- Added ADR-0019 defining code-owned global profile narrowing, immutable project
  manifest materialization and integer request/day budget snapshots.
- Added the Webbin manifest contract for verified provider bindings, exact
  bilingual article/image paths, Spanish source/slug behavior and fail-closed
  locale or translation-policy expansion.
- Added the `@binflow/manifests` validator, migration `0011`, immutable locale
  and budget snapshots, manifest validation evidence, authenticated read API
  and effective-contract/budget controls in the enrollment dashboard.
- Added ADR-0020 and the code-owned `create_blog_draft@1` capability registry,
  immutable manifest-scoped project bindings, capability-catalog validation,
  read-only dashboard projection and migration `0012`.
- Added ADR-0021, Telegram pairing/command ingress, localized tool routing,
  durable request versions/actions/checkpoints, request API/dashboard projection
  and migration `0013` for the workflow-kernel boundary.

### Changed

- Treated an unavailable or incomplete SSR auth-session payload as unauthenticated
  so dashboard middleware redirects to login instead of rendering a 500 error.
- Removed a duplicate auth-schema re-export with no observable contract change.
- Corrected onboarding validation and pairing to resolve the client Telegram bot
  as the documented tenant-owned credential instead of requiring a synthetic
  project integration connection.

- Replaced the AMD64-only ClamAV container with the official pinned Debian
  multi-architecture image so local Apple Silicon and production AMD64 hosts
  use the same native Compose service.
- Moved SecretsProvider and initial credential setup from Phase 1 into Phase 0; Phase 1 dashboard management reuses the same application services.
- Reconciled GitHub security and integration documentation with the registered permission ceiling while preserving least privilege for normal runtime tokens.
- Corrected the GitHub App private key to platform scope with a separate Webbin installation binding and narrowly defined the read-only installation-audit token exception.
- Required tenant-qualified project selection in Phase 0 commands so tenant-local project keys cannot resolve across ownership boundaries.
- Extended the shared Docker dependency stage to include every provider/integration workspace added in this slice.
- Made migration `0002` preserve but revoke all legacy credential shapes so upgrade remains executable without decrypting or silently reinterpreting old ciphertext; operators re-enroll required providers afterward.
- Added deterministic migration revocation audit events, verified-at/external-ID backfill and composite credential/secret project ownership constraints.
- Added strict evidence allowlists, serialized/stale-safe activation, composite tenant/project bindings and globally unique active Telegram bot identities.
- Restricted Phase 0 Webbin bindings to the internal `webbin/webbin` project, made attempt persistence monotonic and allowed same-binding Telegram bot rotation without weakening cross-binding uniqueness.
- Made type-aware lint depend on upstream workspace builds so clean CI checkouts resolve internal package declarations deterministically.
- Scoped the runtime-secret ignore rule to the repository root so the required `packages/secrets` workspace is tracked and available in clean CI checkouts, with a lockfile-to-tracked-manifest CI regression check.
