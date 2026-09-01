# Admin dashboard

## Purpose

The dashboard is the platform owner's private control plane. It configures clients and integrations, shows workflow evidence and exposes authorized administrative decisions. It is not a client-facing CMS or freeform website editor.

The first-MVP dashboard UI is English.

## Navigation

```text
Sidebar
  Main: Home · Clients · Requests · Tickets
  Tools: Catalog · Customizations
  System: Integrations · Operations · Analytics
  (footer) email · Sign out
```

Primary navigation is a persistent left **sidebar** (`AppShell`) on every
authenticated operational page (ADR-0044, [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)).
Zones:

- **Main:** Home, Clients, Requests, Tickets — daily operations.
- **Tools:** Catalog (`/tools`) and Customizations — capability and voice
  configuration (direct sidebar links, not a dropdown).
- **System:** Integrations, Operations, and Analytics — platform readiness and
  metrics (direct links). Login, two-factor, and Security use the auth layout
  without the shell. Security is not listed in the System menu; it remains
  reachable for mandatory TOTP enrollment and session management when the auth
  flow requires it.

Approvals are not a separate top-level page; pending admin approvals surface on
Home and in the top section of Requests.

Documented but not yet built as pages: Projects, Content catalog, Usage API
aggregation, Audit, and a dedicated Settings hub (Integrations / Operations /
Analytics cover the MVP platform settings and metrics surfaces).

## Tools

The Tools catalog lists code-owned capabilities grouped by stack (`astro_repo`
today). Operators can **search** by display name, id, command, or stack; **filter**
to one available stack (or all stacks); and **sort** by name or stack. Each tool
detail shows a read-only **flowchart** of nodes (solid arrows
for unconditional edges, dashed arrows labeled with `when` predicates), kind
badges, effective model/effort for agent nodes, and rendered rules. The
flowchart fills the panel width (no horizontal overflow; shrink-to-fit on
narrow viewports) and grows vertically with the graph. Branching nodes place
successors on distinct horizontal columns so edges stay readable. Base
configuration is
edited through repository skills and PRs, not through freeform dashboard
mutation of topology.

Client assignment on the tool detail page lists only enrollments whose
`projectProfile` matches the tool’s `profile` / stack. Assignment calls
`PUT /api/v1/projects/:projectId/capabilities`, which rejects bindings when the
project profile is absent from the capability’s `allowedProfiles`
(`capability_profile_incompatible`) or when the capability row is missing from
`capability_definitions` (`capability_definition_missing` — run `pnpm db:migrate`).
API error messages are surfaced in the assignment panel.

## Customizations

Select a client, list assigned tools, download the native customization
template, download the current version, or upload a new markdown document.
Uploads are validated against the template sections (including optional
`## content_schema` YAML), size-capped, scanned, and stored as append-only
versions. Customization is untrusted: it may declare allowlisted content fields
(ADR-0035) and style guidance, but cannot change models, paths, approvals or
bypass code-owned schema compilation.

Webbin portfolio voice and rich fields for `create_project_astro` ship as
`docs/customizations/webbin-create-project-astro.md` — upload from this page (or
run `pnpm --filter @binflow/tools exec tsx scripts/upload-webbin-project-customization.ts` locally).
Until uploaded, generation uses neutral template defaults and base fact
collection only.

## Authentication

- `/login`: email and password.
- `/two-factor`: TOTP or unused backup code.
- `/security`: enable TOTP, regenerate backup codes and revoke sessions.
- No public signup or password reset email in the first MVP; recovery follows the documented bootstrap/break-glass process.
- Routes containing credentials, enrollment mutation or approvals require a verified two-factor session.
- A successful TOTP or backup-code challenge revalidates the browser session and
  replaces the current document with the intended authenticated route. The
  dashboard must not render `/login` again or require a manual refresh before
  showing the authenticated surface.
- Password-only sessions may access only `/security`, sign-out and the auth
  calls needed to finish TOTP enrollment.
- Every login after enrollment requires TOTP or one unused backup code. Trusted
  device bypass is not offered.
- Every protected route and mutation requires a TOTP-verified session with less
  than 30 minutes of inactivity. Deliberate browser activity extends the
  rolling session; inactivity signs out and replaces the document with
  `/login`. Restored or foregrounded pages revalidate server state before they
  remain usable.
- SSR authentication reads the session cookie through the in-process Better Auth
  runtime. Document rendering must not nested-fetch `/api/auth` on the same
  Nuxt server; an unavailable or incomplete session payload is unauthenticated
  and renders `/login` instead of a 500 error. The idle timer must invoke
  browser timer functions as methods; extracting `window.setTimeout` throws.
- Backup codes are rendered once after enrollment or regeneration and the UI
  requires the owner to acknowledge that they were stored before leaving.
- TOTP replacement is not a browser self-service action because disabling the
  only active factor before replacement could strand the sole owner. It uses
  the audited host-level recovery procedure.

## Overview (Home)

Home is the operations cockpit (`/`). It displays:

- **Local clock** next to **Add client**: date `dd-mm-yy` and 24-hour time in a
  button-shaped read-only chip (operator local timezone).
- **Status strip**
  - System health from `GET /api/v1/health` plus `GET /api/v1/readiness`
    (Healthy when API is `ok` and readiness is `ready`).
  - Requests created today (**operator local calendar day**, matching the Home
    clock) and pending admin approvals from a **full cursor walk** of
    `GET /api/v1/requests` (same helper as Analytics; SSR uses
    `useRequestFetch` so session cookies apply). Counts are exact unless the
    walk hits the page cap (`+` suffix). Request summaries include platform
    `open_ticket` collection rows (ADR-0055).
  - **Open tickets** (large): pending count (`new` + `in_process`) from
    `GET /api/v1/admin/tickets`; detail line shows **tickets in total**. Polls
    ~5s and on tab focus. Replaces the prior Clients mix KPI on this strip.
  - Status-strip accents (same left-border language as request inbox): System
    green when healthy / red when not; Pending approvals and Open tickets amber
    when count > 0.
- **Client cards** for every enrollment: display label (from tenant key),
  lifecycle state, project key, requests today and pending approvals for that
  project (from the full request catalog), enrollment step when not operational,
  a settings (cog) control in the card corner that opens the enrollment detail,
  a **Message** control next to **Requests** that opens a modal to queue a
  bounded freeform Telegram note to that client’s paired channel (ADR-0043),
  and a Requests link filtered to that project (`/requests?projectId=…`).
- **Needs attention** actionable links only: pending approvals, unverified or
  invalid credentials, readiness not ready, and enrollments in
  `validation_failed`, `pairing_pending`, `revalidation_required`, or
  `suspended`.

Full day/month AI cost lives on Analytics via `GET /api/v1/usage` (ADR-0056).
Home does not yet surface spend KPIs; it must not invent those totals.

## Analytics

Analytics (`/analytics`) is the control-plane metrics surface (Figma
`analytics-dashboard`). Layout matches the design system dark shell. Cost and
latency panels read the Postgres usage ledger; they never paste Figma mock
dollars, vendors, or tool names.

| Panel | Status | Source |
|---|---|---|
| Total API Spend | Live | `GET /api/v1/usage` (`totalSpendCents`) for the selected range |
| Total Requests | Live (exact) | Full cursor walk of `GET /api/v1/requests`, then filter by `createdAt` for the selected range |
| Avg Cost/Request | Live | Usage `avgCostCentsPerRequest` |
| Avg Latency | Live | Usage `avgLatencyMs` from `model_calls` |
| Tool Usage / Failures donuts | Live (exact) | Same full request catalog + range filter; labels from tools catalog |
| Tool usage table | Live | Exact counts/rates from ranged catalog; Avg Execution Time from Usage `byCapability[].avgLatencyMs` |
| API Cost Over Time | Live | Usage `costOverTime` daily series |
| Requests by Model | Live | Agent-node `model` fields across tool graphs (config mix, not runtime volume) |
| Cost by Client | Live | Enrollment list + Usage `byClient` spend and budget utilization |
| Recent Cost Alerts | Live | Usage `alerts` (budget ceiling vs spend; empty when none) |
| Model Efficiency Index | Live | Usage `efficiency` scores from real cost/token/latency rows |
| Date range control | Live | Same range for request-derived panels and Usage (`24h` / `7d` / `30d` / `all`). Exact request totals (no `50+`) unless the page-cap safety limit truncates |

Cost and latency panels never invent dollars. When Usage returns zeros or empty
series, show those empties. Logfire is not a source for Analytics (ADR-0056).

## Clients and projects

Client list supports create, resume configuration, validate, activate, suspend and archive. Client detail includes:

- Identity, contact, timezone and lifecycle state.
- Conversation locale and content locale policy.
- Dedicated client bot and paired user.
- OpenAI credential health and node model bindings.
- GitHub/Vercel connections.
- Active manifest, rules and capability policies.
- Latest validated manifest version, global profile version, effective
  repository/path boundary and immutable locale snapshot.
- Request/day, model-call, token and estimated USD request/day budget ceilings.
- Content catalog/category state.
- Validation history.
- Usage and requests scoped to the client.
- While client pairing is pending, the detail refreshes on foreground return
  and at a bounded interval. Successful bot-response delivery changes the badge
  to `active` without requiring manual browser refresh. Enrollment
  save/validate/pairing-link mutations use optimistic concurrency (`If-Match`
  on enrollment version). A `409` from a stale version (for example after
  validate advanced the revision) triggers one automatic refresh and retry so
  the operator is not stuck on conflict.

Only `astro_repo` was selectable in the first MVP. Post-MVP, `astro_orbitype`
is also selectable for enrollment (ADR-0045). Other future profile names must
not be shown as operational choices until their acceptance criteria pass.

The enrollment form edits client configuration for draft and live enrollments.
Pre-activation saves move the enrollment back to `configuring` so operators
re-validate. Saves on `active` / `pairing_pending` / `revalidation_required`
keep that state and rematerialize a new immutable active (or matching) manifest
revision when the frozen contract changes — including production URL
(`productionDomain` → `deployment.productionOrigin`, ADR-0048), locales,
editorial fields and budgets. `Validate` materializes or reuses the project
manifest and shows its redacted effective contract. Locale fields offer
English, Spanish and German; operators may enable one or more (ADR-0046).
Monolingual projects use translation policy `none`. Webbin remains an overlay:
English and Spanish content only, both required, Spanish as source and slug
locale, translation fixed to `always_translate`.
The same view shows the effective code-owned capability catalog. Operators
toggle which registry tools are bound to the client after validation; each save
creates a new immutable manifest revision (`PUT
/api/v1/projects/:projectId/capabilities`). Executor schemas, permissions and
approval behavior remain read-only in the UI.

The Tools detail page can assign a tool to validated clients with the same API,
filtering the list to enrollments whose `projectProfile` matches the tool
profile.

## Tickets

Tickets are the admin queue for out-of-catalog client asks (ADR-0055). Nav link
**Tickets** sits under Main, directly below Requests. List route `/tickets`
(query `tab=pending|history`); detail `/tickets/:id`. English UI; no list
breadcrumbs—title **Tickets** only. Detail uses **Back to tickets**, not a
crumb trail.

States: `new` (default), `in_process`, `declined`, `closed`. **Pending** tab:
`new` + `in_process` (badge = pending count). **History**: `declined` +
`closed`. Figma “Mark as resolved” / “Resolved” maps to `closed`. Display label
for `in_process` is **In progress**.

Inbox: Client + Status filters, unread cyan left border + dot when `readAt` is
null, client tag, title, excerpt, relative time, status badge, **Open ticket**,
batch pagination (same 10/30/50 cursor pattern as Requests). Empty Pending
shows **No pending tickets**; empty History shows **No history tickets** — an
empty queue is not an error. Empty list remains valid until Telegram ingest
exists.

Detail: status select, **Mark as resolved** → `closed`, title + public ticket
id (mono cyan), meta (Client, Submitted, Priority, Category), request body,
admin notes, activity log, footer **Message client** (same modal as
enrollment/request; ticket-scoped API) + **Mark as resolved**. Opening detail
calls `POST …/read` (idempotent). Never show chat IDs or secrets.

## Requests

Module 7 lists request ID, client/project, capability, topic, current version,
state and timestamps. Detail shows redacted structured input, confirmed plan and
checkpoint state, never raw Telegram updates, credentials or hidden reasoning.

The requests inbox is stacked vertically. The top section is requests in
`AWAITING_ADMIN_APPROVAL`. The section below is every other state (in progress,
completed, failed, cancelled, superseded). A client tag (`clientName`) sits
above each request title on the list and on the detail page. **Open request**
loads `/requests/:id` as a full document so the detail page renders only that
request; it never renders the inbox list alongside the detail.

Request summaries include `approvalStatus` from the request’s
`terminalResult` when present (used for messaging and detail actions). Inbox
cards follow the Figma state accent: dark surface with a colored left border
and matching status badge / client label —
`COMPLETED` and publish-path states green, in-progress / preview blue,
awaiting / revision amber, `CANCELLED` / `SUPERSEDED` neutral grey, failed
rose.

Shared list controls:

- Client filter defaults to **All**, whose option value is the `all-clients`
  sentinel and maps to an absent `projectId` query parameter. Opening
  `/requests?projectId=<id>` (for example from a Home client card) selects that
  client. Select items must never bind the empty string, which the component
  reserves for clearing a selection. Other options come from operational
  enrollments (`active`, `revalidation_required`) and from clients visible in
  the loaded request batches (label is tenant display name from requests, or a
  title-cased tenant key from enrollments). Changing the client filters both
  sections.
- Page size 10, 30 or 50 (default 10). Changing size resets the Requests section
  to the newest batch. The approval queue shows the newest batch for the selected
  page size (no separate “next approval batch” control).
- The Requests section has **Previous requests batch** and **Next requests
  batch**. Next is enabled when `nextCursor` is present; Previous is enabled
  after the operator has advanced at least once. Both replace the current batch
  (they do not append). Changing client or page size resets to the newest batch.

Later list filters remain specified for capability, requester, date range, risk
and failure class; they are not in this inbox slice.

Detail view:

- Original user message and attachments metadata.
- Structured input and confirmed plan as labeled fields, not a raw JSON dump.
- Frozen graph/node/model/prompt/manifest/rule/policy versions.
- **Stage log**: append-only workflow checkpoints for the current request
  version — node id, timestamp and a redacted summary (`requestState`,
  `errorCategory` only). Never chain-of-thought, credentials or raw provider
  payloads. While the request is non-terminal, the detail view polls on a
  bounded interval and refreshes when the tab becomes visible (same pattern as
  pending client pairing). Pages must pass timer callbacks bound to the global
  object; handing `setInterval`/`clearInterval` to the refresh helper as
  detached references throws `Illegal invocation` in the browser and aborts the
  view.
- State timeline and node attempts.
- Category and similarity decisions.
- Research evidence references.
- Generated artifacts and before/after hashes.
- Branch, commit, PR, checks and preview routes.
- Required/received approvals.
- Model usage and cost.
- Production verification and error history.

The dashboard never displays private chain-of-thought. It displays generated rationale, evidence and objective tool results.

Module 8 returns preview URLs, exact file paths, PR/head/deployment identifiers,
approval requirements, provider-safe failure details (`failure`: category,
message, failed node) and the stage log in request detail. The preview-evidence
card renders only when head commit or preview URLs exist.
Approve, reject, revise and cancel use the same idempotent application service
as Telegram; the UI never calculates approval policy.

**Reject** (dashboard or admin Telegram) transitions the request to **`CANCELLED`**
and enqueues a neutral **`request.cancelled`** notice to the client (ADR-0050).
Reject no longer leaves the request in `REVISION_REQUESTED` with
`approvalStatus: admin_rejected`.

Cancelling from the detail page also queues the same client notice (ADR-0027).
The dashboard does not confirm delivery: the response reports the committed
transition, and the notice is delivered asynchronously by the worker. Approve
and revise do not notify the client. Optional freeform **Message client** remains
enrollment-scoped only; post-reject request messaging is superseded by automatic
cancellation notice.

The Operations settings screen creates the one-time admin Telegram pairing
link and projects the redacted active target. Pairing requires a non-idle,
TOTP-verified session; a generated link is shown once and cannot be recovered.
Refreshing the target projection never signs the owner out; an expired idle
session returns the owner to login before another link can be created.

## Approval behavior

- Approval view shows project, capability, risk, request version, exact preview, checks, diff summary and expiry.
- Admin approval is available only when effective policy requires it.
- Approve/reject uses optimistic concurrency and the same idempotent application service as Telegram (ADR-0050).
- Admin Telegram: paired owner may approve/reject `AWAITING_ADMIN_APPROVAL` via inline buttons; reject cancels with client notice.
- A stale page, changed SHA or already-decided action refreshes current state instead of repeating the action.
- Existing-category Webbin blogs do not ask admin approval; the admin still receives activity notifications.

## Credentials

- The Integrations list supports **search** (alias, kind, client, status),
  **client filter** (tenant binding key, or Platform for unbound rows), and
  **sort** (alias, client, or status).
- Forms accept a secret once over TLS.
- After saving, display provider, alias, health, masked suffix, last tested/used and status.
- Test, rotate and revoke are separate audited actions.
- Rotation triggers project revalidation before dependent capabilities continue.
- The browser never receives ciphertext, DEK or resolved secret values.
- Candidate forms are strict per provider. GitHub accepts an explicitly selected
  PEM file once and transmits its bounded contents, never a local filesystem path.
- Verification displays only stable outcome/error and refreshed health metadata;
  provider evidence remains server-side.
- Lifecycle: `unverified` → `active` on successful verify; a newer verified
  candidate for the same owner scope/kind marks the prior row `superseded`.
  `revoked` is explicit and permanent for that version. Runtime resolution uses
  only the current `active` credential per scope/kind.

## Content catalog

- Shows synchronized articles by locale, slug, title, category, source revision and state.
- Shows active orchestrator drafts separately.
- Admin can start a sync and inspect failures.
- Catalog is not a content editor.
- Category list shows normalized usage and whether a request proposes a new category.

## Usage and audit

Usage groups calls/cost by tenant, project, request, capability, node, provider, model, day and month. Audit supports correlated lookup by request, graph, node, provider request, PR and deployment IDs.

## Accessibility and UX

- Keyboard-operable controls and visible focus.
- Semantic labels, status text in addition to color and WCAG AA contrast. Solid
  action colors resolve to concrete Nuxt UI palette tokens so white action text
  is never rendered over a transparent or white background.
- Confirmation dialogs name the exact resource and consequence.
- Long-running actions return immediately with trackable state.
- Error messages state what failed, whether retry is automatic and who must act.
- Responsive, desktop-first layout; critical approvals remain usable on mobile.

## Forbidden dashboard behavior

- No arbitrary SQL, shell or repository browser.
- No raw secret display.
- No capability/manifest generated and activated by a model.
- No direct Markdown/WYSIWYG editing in the MVP.
- No button that bypasses preview, policy or current-version validation.
