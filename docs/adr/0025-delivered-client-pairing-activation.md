# ADR-0025: Delivered client pairing activates enrollment

- Status: Accepted
- Date: 2026-08-19
- Supersedes: The activation-check placement in ADR-0017
- Superseded by: None

## Context

The implemented pairing transaction consumes the one-time token, creates the
channel identity, activates the client membership and records successful
`client_pairing` evidence, but leaves `client_enrollments.state` at
`pairing_pending`. The client can already use `/tools`, so the dashboard state
is both stale and misleading. ADR-0017 also placed reversible repository and
preview probes before activation even though the first real request performs
those same checks against an exact draft and cannot publish without them.

## Decision

- `pairing_pending` means that the deep link has been issued but the client bot
  has not yet delivered the successful pairing response.
- Pairing token consumption atomically creates the channel identity,
  conversation, active membership and immutable `client_pairing` evidence.
- Only after Telegram successfully posts the localized pairing response does a
  second idempotent application transaction record `telegram_test_send`
  evidence and move the enrollment from `pairing_pending` to `active`. The
  transition increments the aggregate version and writes audit and outbox
  events atomically.
- Delivery failure leaves the enrollment pending. A replay of the same Telegram
  update resolves the already-created pairing identity and can safely complete
  delivery/activation without consuming another token.
- Activation requires current successful configuration, provider credential,
  project manifest, capability catalog, client-pairing and Telegram-delivery
  evidence. Content-catalog synchronization, the reversible GitHub branch
  operation and Vercel preview/SHA correlation execute in the exact blog
  request and remain fail-closed before client approval or publication.
- While pairing is pending, the dashboard refreshes the enrollment when the tab
  becomes visible and at a short bounded interval. It stops polling once the
  state changes.

## Consequences

- The dashboard and the actual Telegram authorization state converge without a
  manual refresh or an inaccurate permanent `pairing_pending` badge.
- A successful inbound `/start` alone is insufficient; outbound delivery is
  part of activation evidence.
- Publication guardrails are not removed. Mutable repository/deployment checks
  bind to the actual request artifact rather than a synthetic onboarding
  artifact.
- A delivery followed by a database outage may produce a visible duplicate on
  retry, but cannot duplicate identity, membership or activation state.

## Alternatives considered

- Mark active inside token consumption: rejected because Telegram may fail to
  deliver the confirmation.
- Keep pairing pending until a manual Activate button: rejected because the
  bot has already granted the paired identity access and the state would remain
  misleading.
- Run a synthetic GitHub/Vercel mutation during enrollment: rejected because it
  duplicates request-time controls and creates unrelated pilot mutations.

## Verification

Tests cover delivery success/failure ordering, update replay, idempotent
activation, aggregate version/audit/outbox changes, required evidence, dashboard
foreground/poll refresh and the end-to-end `pairing_pending -> active` flow.
