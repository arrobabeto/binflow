# Feature spec: Admin Telegram approval actions

- Slug: `admin-telegram-approval`
- Status: Approved for implementation
- Primary type: `integration`
- Secondary types: `workflow_kernel`, `security_trust`
- Date: 2026-08-31
- Owner: platform owner

## Problem

Requests in `AWAITING_ADMIN_APPROVAL` can only be approved or rejected from the
TOTP-verified dashboard. The admin Telegram bot sends plain-text
`admin_approval_required` notices without inline actions, so the owner must
context-switch to the dashboard for every pending approval.

## Actor and outcome

- Actor: platform owner paired to the global admin Telegram bot (ADR-0023).
- Success criteria:
  - When a request enters `AWAITING_ADMIN_APPROVAL`, the admin bot receives a
    card with a **clear summary** of the action and implications, plus inline
    buttons **Approve** and **Reject**.
  - Button clicks invoke the **same idempotent application service** as
    `POST /api/v1/requests/:id/approve` and `POST /api/v1/requests/:id/reject`.
  - **Reject** (Telegram or dashboard) transitions the request to **`CANCELLED`**
    and enqueues **`request.cancelled`** to the paired client conversation
    (ADR-0027).
  - **Approve** continues the existing publish path (`APPROVED_FOR_PUBLISH` →
    workflow resume).
  - Stale SHA, wrong state, expired token, or duplicate click returns a safe
    denial without double-applying.
- Freeze (must not change):
  - Policy still determines *when* admin approval is required; Telegram cannot
    bypass preview/version/artifact checks.
  - Client bot topology and action-token security model (ADR-0026).
  - ADR-0042 shared-port scopes.
  - Scope is **`AWAITING_ADMIN_APPROVAL` only** for this feature; no other
    admin states gain Telegram buttons yet.

## Behavior

### In scope

- Extend `admin_approval_required` delivery to post a **card** with:
  - Tenant / project keys and display context.
  - Capability id and human-readable tool name.
  - Request topic or deletion target summary.
  - **Why admin approval is required** (e.g. new blog category, deletion PR
    ready for merge).
  - **Implication text** (approve → merge/publish path; reject → request
    cancelled, client notified).
  - Optional preview/PR links when policy allows (same rules as client preview
    URLs; no secrets).
  - Inline buttons: localized **Approve** / **Reject** labels.
- Issue hashed, single-use **admin action tokens** bound to:
  `role=admin`, request id, request version, head SHA, preview deployment id,
  artifact id, expiry.
- Admin bot ingress: `callback_query` and `/action <token>` for paired admin
  target only (`adminNotificationTargets` match on bot + user + chat).
- Dashboard **reject** aligned to **`CANCELLED`** + client `request.cancelled`
  (same as Telegram reject).
- Audit: `request.admin_approved` / `request.admin_rejected` (or cancel
  equivalent) with actor `telegram-admin:<externalUserId>` when from Telegram.

### Out of scope

- Telegram approve/reject for states other than `AWAITING_ADMIN_APPROVAL`.
- Admin **revise** from Telegram.
- Freeform rejection reason in the Telegram message (reject uses code-owned
  cancellation copy to the client).
- Replacing dashboard approve/reject UI.
- TOTP step-up inside Telegram.

### Failure modes

- Unpaired Telegram user clicks button → access denied; no state change.
- Token expired or request no longer `AWAITING_ADMIN_APPROVAL` → localized
  denial; refresh summary optional.
- Head SHA / deployment drift vs token binding → conflict; no publish.
- Worker send-only mode → buttons delivered when notification posts; clicks
  require polling ingress on admin bot (existing ops invariant).

### Acceptance criteria

1. Request in `AWAITING_ADMIN_APPROVAL` delivers admin card with summary +
   Approve/Reject.
2. Approve from Telegram merges/publish path matches dashboard approve for the
   same frozen version.
3. Reject from Telegram sets `CANCELLED` and client receives `request.cancelled`.
4. Dashboard reject matches Telegram reject semantics.
5. Duplicate approve/reject is idempotent or safely denied.
6. Unpaired admin cannot act.
7. Regression: client preview/plan buttons unchanged.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Telegram admin approve/reject (paired target, action tokens) | Approve | 2026-08-31 |
| Reject → `CANCELLED` + client notice (dashboard aligned) | Approve | 2026-08-31 |
| Scope: `AWAITING_ADMIN_APPROVAL` only | Approve | 2026-08-31 |

## Documentation impact assessment

Required by [`AGENTS.md`](../AGENTS.md):

- Canonical documents changed: `TELEGRAM.md`, `DASHBOARD.md`, `WORKFLOWS.md`,
  `CONTRACTS.md`, `SECURITY.md`, `MVP.md`, `TESTING.md`, `CHANGELOG.md`.
- ADRs: **0050** (new); **0043** amended (reject no longer `admin_rejected`);
  **0009** clarified (dashboard TOTP vs Telegram paired admin).
- Public contracts: admin notification payload may include action token refs;
  reject API outcome state `CANCELLED`; tests for Telegram admin ingress.
- Migration: none; behavior change on reject is forward-only for new decisions.

## Compatibility

- Tools affected: any capability that reaches `AWAITING_ADMIN_APPROVAL`
  (`create_blog_draft` new category, `delete_blog_draft`, `delete_project_astro`, …).
- ADR-0042: no shared-port widening.

## Handoff

Implementation is a **separate** Agent-mode request. Suggested order:

1. Unify reject → `CANCELLED` + `request.cancelled` in workflow service
   (dashboard + future Telegram).
2. Admin action token issue/bind at `admin_approval_required` enqueue time.
3. Card renderer for admin notifications (worker).
4. `handleAdminTelegramUpdate` action consumption → approve/reject service.
5. Tests: workflow, messaging, API, Telegram handler.
