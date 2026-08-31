# ADR-0050: Admin Telegram approval actions

- Status: Accepted
- Date: 2026-08-31
- Supersedes: None
- Supersedes in part: [0043](0043-admin-client-direct-messages.md) (reject path)
- Extends: [0023](0023-admin-notifications-and-production-readiness.md), [0026](0026-telegram-inline-action-buttons.md), [0021](0021-telegram-ingress-and-durable-request-kernel.md)

## Context

`AWAITING_ADMIN_APPROVAL` requests require platform-owner authority. The dashboard
already exposes approve/reject through a TOTP-verified session and an idempotent
application service. The admin Telegram bot delivers `admin_approval_required`
as plain text only. `docs/MVP.md` and `docs/DASHBOARD.md` already state that
bot and dashboard use the same approval service, but `docs/TELEGRAM.md` deferred
interactive admin decisions to the dashboard for the local-first MVP.

Owners approved enabling **Approve** / **Reject** inline buttons on the paired
admin bot for **`AWAITING_ADMIN_APPROVAL` only**, with reject transitioning to
**`CANCELLED`** and notifying the client via **`request.cancelled`**.

## Decision

1. **`admin_approval_required` notifications** post as a Chat SDK card with:
   - A concise, code-owned summary: tenant/project, capability, topic/target,
     why admin approval is required, and what approve vs reject implies.
   - Inline buttons **Approve** and **Reject** whose callback identifiers are
     opaque admin action tokens (same pattern as ADR-0026).
   - Optional URL buttons for preview routes when the request has valid preview
     evidence and policy allows (no PR secrets in Telegram).
2. **Admin action tokens** are hashed at rest, single-use, TTL-bound, and bind
   `role=admin`, request id, optimistic version, head commit SHA, preview
   deployment id, and artifact id. Consumption uses the same authorization
   checks as dashboard approve/reject.
3. **Telegram ingress** for admin decisions:
   - Only the active `adminNotificationTargets` row (exact bot ID, external user
     ID, chat ID) may consume admin action tokens.
   - `callback_query` and typed `/action <token>` share the client ingress
     contract; the clicking user’s ID authorizes the action.
4. **Approve** calls the existing approve path → `APPROVED_FOR_PUBLISH` and
   workflow resume. **Reject** calls the unified reject path → **`CANCELLED`**
   and enqueue **`client.notification_requested`** with
   `notificationType: request.cancelled` (same neutral copy as dashboard
   cancel).
5. **Dashboard reject** uses the same **`CANCELLED`** transition and client
   notice. Reject no longer sets `REVISION_REQUESTED` /
   `approvalStatus: admin_rejected`.
6. **Authentication carve-out:** dashboard secret management and enrollment
   mutation still require TOTP (ADR-0009). **Request approval decisions** may
   also be taken from the **paired admin Telegram target** without a parallel
   TOTP prompt, because pairing required a fresh TOTP dashboard session
   (ADR-0023) and action tokens bind to the paired identity. This does not
   extend to credential rotation, enrollment edits, or arbitrary API access.
7. **Scope limit:** only requests in **`AWAITING_ADMIN_APPROVAL`** expose admin
   Telegram buttons in this ADR. Other admin workflows stay dashboard-only
   until separately documented.

## Consequences

- Owners can approve or reject from mobile Telegram without opening the
  dashboard, within the paired-chat trust boundary.
- Reject is terminal cancellation with automatic client notice; optional
  post-reject freeform messaging (ADR-0043 request-scoped) no longer applies
  to new rejects because `admin_rejected` is not produced.
- Admin notification delivery must use card posting (not plain `postMessage`
  strings) when action tokens are present.
- Security reviews must treat compromise of the paired admin Telegram account
  as compromise of approval authority for pending requests.

## Alternatives considered

- Dashboard-only approvals: rejected per owner approval.
- Reject → `REVISION_REQUESTED` / `admin_rejected`: rejected; owner chose
  cancel + client notice.
- Require TOTP on every Telegram action: rejected as impractical; pairing +
  tokens are the control.

## Verification

- Workflow tests: Telegram and dashboard reject → `CANCELLED` + client outbox;
  approve → publish path; stale token/version denied.
- Messaging tests: admin card renders Approve/Reject; callback uses admin target
  identity.
- Security tests: unpaired user denied; token replay denied.
- Regression: client plan/preview buttons unchanged.
