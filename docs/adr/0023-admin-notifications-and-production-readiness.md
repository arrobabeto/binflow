# ADR-0023: Admin notifications and production readiness

- Status: Accepted
- Date: 2026-08-18

## Context

The MVP has a client Telegram request path and an approval-gated blog executor.
It still needs a trustworthy destination for global operational notifications
and a fail-closed contract for the later VPS webhook cutover.

## Decision

1. The platform owner pairs the global admin bot with a random, single-use,
   hash-only token created through a fresh two-factor dashboard session. A bot
   conversation is never trusted merely because it sent `/start`.
2. The active admin target is identified by exact verified bot ID, Telegram user
   ID and chat ID. Re-pairing revokes the old target and every transition is
   audited.
3. A client blog request, every transition that requires platform-owner
   approval, and every terminal `FAILED_FINAL` workflow stop produce a durable
   admin-notification outbox event. Required notification types include
   `request.created`, `admin_approval_required`, `request.failed_final`, and
   `request.published` when production is verified. Delivery is retryable and
   does not advance workflow state.
4. Local mode keeps separate admin/client polling namespaces. The production
   profile remains disabled until the VPS cutover implements separate webhook
   paths and secrets, validates the Telegram secret header and deduplicates
   updates before the application service. This cutover is not part of the
   local-first MVP acceptance run.
5. Health is split into liveness and readiness. Readiness fails when PostgreSQL,
   Redis, object storage, required credentials or worker heartbeats are stale.
6. The worker retries pending notifications with bounded backoff. Maintenance
   marks exhausted notification work as dead-letter, flags incomplete
   publication attempts from recorded provider IDs, cleans expired
   plaintext-free action records and reports the result. It never guesses or
   deletes remote resources.
7. The local end-to-end acceptance suite uses fakes and is forbidden from
   enabling live provider mutations. A real Webbin article remains an explicit
   owner-supplied acceptance action.

## Consequences

- Admin notifications survive process restarts and cannot be redirected by an
  arbitrary Telegram user.
- Production configuration can be prepared without committing secrets.
- The MVP can be demonstrated safely end to end locally while the live mutation
  switch remains off by default.

## Rollback

Disable live execution and any later webhook ingress, stop workers, preserve audit/outbox
records, and restore the coordinated application/database backup. Revert a
Telegram target by revoking it and issuing a new one-time pairing link; do not
edit chat IDs directly.
