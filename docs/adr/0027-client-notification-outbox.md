# ADR-0027: Durable client-notification outbox for admin-initiated cancellation

- Status: Accepted
- Date: 2026-08-20
- Supersedes: None
- Superseded by: None

## Context

ADR-0023 decision 3 defines a durable admin-notification outbox and enumerates
its required event types. It says nothing about notifying a client when the
platform owner changes a request from the dashboard.

That gap is observable. `POST /api/v1/requests/:requestId/cancel` moves the
request to `CANCELLED` and records an audit event, but no notification is
produced on either side. The client's Telegram thread keeps the last
progress notice forever, so a request the owner already killed still looks
active to the client.

The gap is structural, not a missing call. Client notices are posted from the
worker process while it executes a `workflow.resume` job. The API process holds
no client Telegram runtime, and the worker's outbox drain filters exclusively on
`admin.notification_requested`. No transport exists for an API-initiated
transition to reach a client conversation.

Cancellation is also the one terminal transition a client cannot infer from any
later message, because a cancelled request never produces preview, failure or
publication notices.

## Decision

1. A second durable outbox event type, `client.notification_requested`, carries
   client-facing notices. It reuses the existing `outbox_events` table, unique
   `job_key` idempotency, bounded retry and dead-lettering. Delivery never
   advances workflow state and never blocks the transition that produced it.
2. Admin-initiated cancellation through the request application service enqueues
   exactly one such event in the same transaction as the state change. The
   transition remains authoritative if delivery later fails.
3. The message is rendered at enqueue time in the client's stored conversation
   locale, from the same code-owned copy table used by the synchronous Telegram
   reply. A request whose conversation locale cannot be resolved produces no
   event rather than an English fallback, consistent with ADR-0011.
4. The client notice is neutral and does not attribute the cancellation to an
   actor, identify the platform owner, or expose dashboard paths. It states the
   terminal outcome only. Admin-facing detail stays in the dashboard and audit
   trail.
5. Cancellation produces no admin notification. The platform owner is the actor
   and already observes the result in the dashboard response, so an outbox event
   addressed to the actor would be redundant delivery, not evidence.
6. Client-initiated `/cancel` keeps its synchronous in-thread reply and does not
   enqueue an event. The client is the actor there, and duplicating the reply
   through the outbox would post the same copy twice.
7. The worker drains client notifications on the same schedule as admin
   notifications, resolving the destination chat per request through the paired
   channel identity. It never accepts a chat ID from an event payload.

## Consequences

- The dashboard can terminate a request without leaving the client's
  conversation in a stale state.
- A client-facing delivery channel now exists for any future API-initiated
  transition. This change deliberately uses it only for cancellation; approval,
  rejection and revision from the dashboard remain undocumented and unimplemented
  until a later ADR extends this decision.
- A silent conversation is the failure mode when locale resolution fails, which
  is preferable to a mixed-language notice and is visible in the audit trail.

## Alternatives considered

- Rendering the notice in the worker at delivery time: rejected because it would
  move the locale decision and the copy table out of the application service that
  owns the transition, splitting one authorization decision across two processes.
- Storing the destination chat ID in the event payload: rejected because it would
  let a stored payload redirect a client message, weakening the pairing boundary
  ADR-0007 establishes.
- Reusing `admin.notification_requested` with an audience field: rejected because
  a misrouted or malformed audience would deliver client copy to the admin chat,
  or the reverse.

## Rollback

Stop the client-notification drain. Pending events remain durable and unsent;
no workflow state depends on them. Cancellation continues to work through the
dashboard and audit trail, and the conversation returns to the previous
behavior of receiving no cancellation notice.
