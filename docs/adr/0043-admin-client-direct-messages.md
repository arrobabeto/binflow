# ADR-0043: Bounded admin→client Telegram direct messages

- Status: Accepted
- Date: 2026-08-29
- Supersedes: None
- Superseded by: None
- Extends: [0027](0027-client-notification-outbox.md)

## Context

ADR-0027 opened a durable `client.notification_requested` channel for
API-initiated client notices and deliberately limited it to dashboard
cancellation. Platform owners still need to write a freeform explanation to a
paired client Telegram conversation—from a Home client card, or after rejecting
a request—without turning the dashboard into an open chat product or letting a
stored payload redirect delivery.

Code-owned copy remains the default for workflow notices. Freeform admin text is
a narrow exception: the owner already has TOTP-verified dashboard authority, and
the client must see why a category was rejected when the owner chooses to say so.

## Decision

1. The dashboard may enqueue bounded freeform plain-text messages to a paired
   client conversation through the existing `client.notification_requested`
   outbox. Maximum body length is **2000** Unicode characters after trim;
   empty bodies are rejected. No HTML/Markdown editor; the body is sent as typed.
2. Two entry points exist:
   - Enrollment-scoped: `POST /api/v1/admin/enrollments/:id/messages`
   - Request-scoped: `POST /api/v1/requests/:id/messages`, allowed **only** when
     the request’s `terminalResult.approvalStatus` is `admin_rejected`.
3. Approve, reject, and revise remain independent of messaging. Reject never
   requires or auto-sends a message. The Message control on request detail
   appears only after rejection.
4. Destination chat IDs never appear in the outbox payload. Enrollment-scoped
   events use `aggregateType: enrollment`; request-scoped events use
   `aggregateType: request`. The worker resolves the active channel identity at
   delivery time (project/tenant for enrollment; request user for request).
5. A short code-owned locale prefix (from the conversation locale when
   resolvable) may precede the admin body. Missing locale uses a neutral
   English prefix rather than translating the freeform body (ADR-0011 still
   forbids inventing a client locale for workflow copy; freeform is owner-authored).
6. The Message modal shows a redacted **Sending to** channel summary
   (`clientName`, `tenantKey`, `projectKey`, `botUsername`) loaded for the same
   enrollment or request id. There is no recipient picker; the POST is bound to
   that id.
7. Delivery is asynchronous. The API response means “queued,” not “delivered.”
   Audit records enqueue and delivery without logging the full freeform body in
   worker metadata (length and outbox id only).

## Consequences

- Owners can explain rejections and message a client without a new transport.
- Freeform text is an audited exception to code-owned workflow copy, tightly
  gated by length, pairing, and (for requests) prior admin rejection.
- Worker drain must handle both `request` and `enrollment` aggregates for
  client notifications.

## Alternatives considered

- Auto-send on reject with a required explanation field: rejected because it
  couples a state transition to delivery and blocks reject when Telegram is
  down.
- Storing chat IDs in the payload: rejected (ADR-0027 / ADR-0007).
- Open chat inbox in the dashboard: rejected as out of MVP scope.

## Verification

- Contract tests reject empty and overlong bodies.
- Request-scoped send succeeds only after `admin_rejected`; awaiting-approval
  and approved/published states are rejected.
- Reject/approve produce zero message outbox rows.
- Enrollment and request drains deliver through paired identity only.
- Message-target projection returns no chat IDs or secrets.
