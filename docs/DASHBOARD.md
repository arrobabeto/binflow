# Admin dashboard

## Purpose

The dashboard is the platform owner's private control plane. It configures clients and integrations, shows workflow evidence and exposes authorized administrative decisions. It is not a client-facing CMS or freeform website editor.

The first-MVP dashboard UI is English.

## Navigation

```text
Home
Clients
Requests
Tools ▸ Catalog · Customizations
System ▸ Integrations · Operations
```

Primary navigation is a persistent shell (`AppShell`) on every authenticated
operational page. Zones:

- **Primary:** Home, Clients, Requests — daily operations.
- **Tools menu:** Catalog (`/tools`) and Customizations — capability and voice
  configuration.
- **System menu:** Integrations and Operations — platform readiness. Login,
  two-factor, and Security use the auth layout without the shell. Security is
  not listed in the System menu; it remains reachable for mandatory TOTP
  enrollment and session management when the auth flow requires it.

Approvals are not a separate top-level page; pending admin approvals surface on
Home and in the left column of Requests.

Documented but not yet built as pages: Projects, Content catalog, Usage, Audit,
and a dedicated Settings hub (Integrations / Operations cover the MVP platform
settings surfaces).

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

- **Status strip**
  - System health from `GET /api/v1/health` plus `GET /api/v1/readiness`
    (Healthy when API is `ok` and readiness is `ready`).
  - Requests created today (UTC), counted from recent request list batches
    (`limit=50` for approval and other columns). When a batch has
    `nextCursor`, the count may show a `+` suffix (approximate).
  - Pending admin approvals from `GET /api/v1/requests?needsAdminApproval=true`
    (same approximate rule).
  - Client mix: active (including `revalidation_required`) over total
    enrollments, with an attention hint when enrollments need action.
- **Client cards** for every enrollment: display label (from tenant key),
  lifecycle state, project key, requests today and pending approvals for that
  project (from the same recent batches), enrollment step when not operational,
  a settings (cog) control in the card corner that opens the enrollment detail,
  and a Requests link filtered to that project (`/requests?projectId=…`).
- **Needs attention** actionable links only: pending approvals, unverified or
  invalid credentials, readiness not ready, and enrollments in
  `validation_failed`, `pairing_pending`, `revalidation_required`, or
  `suspended`.

Full day/month AI cost and exhaustive request totals remain specified for a
future Usage surface (`GET /api/v1/usage`); Home does not invent those totals
until that API is wired into the UI.

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
  to `active` without requiring manual browser refresh.

Only `astro_repo` is selectable in the first MVP. Future profile names must not be shown as operational choices until their acceptance criteria pass.

The enrollment form edits a draft configuration. `Validate` materializes or
reuses the project manifest and shows its redacted effective contract. Webbin
offers English and Spanish content only, requires both, uses Spanish as source
and slug locale, and fixes translation to `always_translate`; globally
supported German and `ask_each_action` remain unavailable for this pilot.
The same view shows the effective code-owned capability catalog. Operators
toggle which registry tools are bound to the client after validation; each save
creates a new immutable manifest revision (`PUT
/api/v1/projects/:projectId/capabilities`). Executor schemas, permissions and
approval behavior remain read-only in the UI.

The Tools detail page can assign a tool to validated clients with the same API,
filtering the list to enrollments whose `projectProfile` matches the tool
profile.

## Requests

Module 7 lists request ID, client/project, capability, topic, current version,
state and timestamps. Detail shows redacted structured input, confirmed plan and
checkpoint state, never raw Telegram updates, credentials or hidden reasoning.

The requests inbox is two columns. The left column is requests in
`AWAITING_ADMIN_APPROVAL`. The right column is every other state (in progress,
completed, failed, cancelled, superseded). A client tag (`clientName`) sits
above each request title on the list and on the detail page. **Open request**
loads `/requests/:id` as a full document so the detail page renders only that
request; it never renders the inbox list alongside the detail.

Shared list controls:

- Client filter defaults to **All**, whose option value is the `all-clients`
  sentinel and maps to an absent `projectId` query parameter. Opening
  `/requests?projectId=<id>` (for example from a Home client card) selects that
  client. Select items must never bind the empty string, which the component
  reserves for clearing a selection. Other options come from operational
  enrollments (`active`, `revalidation_required`) and from clients visible in
  the loaded request batches (label is tenant display name from requests, or a
  title-cased tenant key from enrollments). Changing the client filters both
  columns.
- Page size 10, 30 or 50 (default 10). Changing size resets both columns to the
  newest batch.
- Each column has **Next batch** when `nextCursor` is present. Next replaces
  the current batch; it does not append.

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

Cancelling from the detail page also queues a neutral, localized notice to the
client's Telegram conversation (ADR-0027). The dashboard does not confirm
delivery: the response reports the committed transition, and the notice is
delivered asynchronously by the worker. Approve, reject and revise do not notify
the client yet.

The Operations settings screen creates the one-time admin Telegram pairing
link and projects the redacted active target. Pairing requires a non-idle,
TOTP-verified session; a generated link is shown once and cannot be recovered.
Refreshing the target projection never signs the owner out; an expired idle
session returns the owner to login before another link can be created.

## Approval behavior

- Approval view shows project, capability, risk, request version, exact preview, checks, diff summary and expiry.
- Admin approval is available only when effective policy requires it.
- Approve/reject uses optimistic concurrency and the same idempotent application service as Telegram.
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
