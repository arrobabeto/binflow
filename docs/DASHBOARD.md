# Admin dashboard

## Purpose

The dashboard is the platform owner's private control plane. It configures clients and integrations, shows workflow evidence and exposes authorized administrative decisions. It is not a client-facing CMS or freeform website editor.

The first-MVP dashboard UI is English.

## Navigation

```text
Overview
Clients
Projects
Requests
Approvals
Content catalog
Usage
Audit
System
Settings
```

## Authentication

- `/login`: email and password.
- `/two-factor`: TOTP or unused backup code.
- `/security`: enable TOTP, regenerate backup codes and revoke sessions.
- No public signup or password reset email in the first MVP; recovery follows the documented bootstrap/break-glass process.
- Routes containing credentials, enrollment mutation or approvals require a verified two-factor session.
- Password-only sessions may access only `/security`, sign-out and the auth
  calls needed to finish TOTP enrollment.
- Every login after enrollment requires TOTP or one unused backup code. Trusted
  device bypass is not offered.
- Sensitive security, secret, integration and approval mutations require a
  session created within the previous five minutes; the UI sends the owner back
  through login when freshness expires.
- Backup codes are rendered once after enrollment or regeneration and the UI
  requires the owner to acknowledge that they were stored before leaving.
- TOTP replacement is not a browser self-service action because disabling the
  only active factor before replacement could strand the sole owner. It uses
  the audited host-level recovery procedure.

## Overview

Displays:

- Active/suspended/failed enrollments.
- Requests by current state.
- Pending admin approvals.
- Recent client activity and publications.
- Queue/worker/integration health.
- Current-day and current-month AI cost.
- Actionable alerts only; raw log streams remain outside the primary dashboard.

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

Only `astro_repo` is selectable in the first MVP. Future profile names must not be shown as operational choices until their acceptance criteria pass.

The enrollment form edits a draft configuration. `Validate` materializes or
reuses the project manifest and shows its redacted effective contract. Webbin
offers English and Spanish content only, requires both, uses Spanish as source
and slug locale, and fixes translation to `always_translate`; globally
supported German and `ask_each_action` remain unavailable for this pilot.
The same view shows the effective code-owned capability catalog. In the first
MVP `Create blog` is enabled as `create_blog_draft@1`; executor, schemas,
permissions and approval behavior are read-only and cannot be edited in the UI.

## Requests

Module 7 lists request ID, client/project, capability, topic, current version,
state and timestamps. Detail shows redacted structured input, confirmed plan and
checkpoint state, never raw Telegram updates, credentials or hidden reasoning.

List filters:

- Tenant/project.
- Capability.
- State and risk.
- Requester.
- Date range.
- Approval requirement.
- Failure class.

Detail view:

- Original user message and attachments metadata.
- Structured input and confirmed plan.
- Frozen graph/node/model/prompt/manifest/rule/policy versions.
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
approval requirements and provider-safe failure details in request detail.
Approve, reject, revise and cancel use the same idempotent application service
as Telegram; the UI never calculates approval policy.

The Operations settings screen creates the one-time admin Telegram pairing
link and projects the redacted active target. Pairing requires a fresh
two-factor session; a generated link is shown once and cannot be recovered.

## Approval behavior

- Approval view shows project, capability, risk, request version, exact preview, checks, diff summary and expiry.
- Admin approval is available only when effective policy requires it.
- Approve/reject uses optimistic concurrency and the same idempotent application service as Telegram.
- A stale page, changed SHA or already-decided action refreshes current state instead of repeating the action.
- Existing-category Webbin blogs do not ask admin approval; the admin still receives activity notifications.

## Credentials

- Forms accept a secret once over TLS.
- After saving, display provider, alias, health, masked suffix, last tested/used and status.
- Test, rotate and revoke are separate audited actions.
- Rotation triggers project revalidation before dependent capabilities continue.
- The browser never receives ciphertext, DEK or resolved secret values.
- Candidate forms are strict per provider. GitHub accepts an explicitly selected
  PEM file once and transmits its bounded contents, never a local filesystem path.
- Verification displays only stable outcome/error and refreshed health metadata;
  provider evidence remains server-side.

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
