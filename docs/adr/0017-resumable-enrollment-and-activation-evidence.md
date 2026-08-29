# ADR-0017: Resumable enrollment and activation evidence

- Status: Accepted
- Date: 2026-08-18
- Supersedes: None
- Superseded by: ADR-0025 for activation-check placement and pairing completion

## Context

Phase 1 needs an English dashboard that can adopt the Phase 0 Webbin scope,
persist onboarding progress and eventually activate the client without manual
database edits. Activation includes external and sometimes mutable checks that
cannot be inferred from credential health and are not currently authorized
against the read-only Webbin pilot.

## Decision

- `client_enrollments` is the aggregate root for one tenant/project onboarding.
  The first MVP permits one enrollment per tenant and project and only the
  `astro_repo` profile.
- Creating an enrollment adopts an existing Phase 0 draft tenant/project with
  matching keys or creates both atomically. It never duplicates or silently
  rebinds an existing key.
- Wizard configuration is a strict versioned document containing client contact,
  timezone, conversation locale, production/preview domains, content locales,
  slug locale, translation policy and the Webbin editorial policy fields.
- Mutations require a fresh TOTP session, `Idempotency-Key` and the current
  strong ETag through `If-Match`. Each accepted mutation commits aggregate
  state, audit and outbox data atomically.
- Validation writes immutable attempt rows per named/versioned check. A current
  successful result may be reused only while its dependency fingerprint still
  matches; credential rotation or configuration changes make dependent checks
  stale.
- Configuration validation may move an enrollment to `validation_failed` or
  `ready_for_pairing`. Activation additionally requires current successful
  evidence for provider credentials, manifest, catalog, Telegram test send,
  reversible GitHub branch cleanup, Vercel preview/SHA correlation and pairing.
- Missing mutable validation evidence is a blocking result, never a warning or
  simulated success. Under the current Webbin read-only authorization the code
  may be implemented and tested with fakes, but no real branch, deployment,
  message or pairing mutation is executed.
- Pairing tokens are generated only from `ready_for_pairing`, stored as SHA-256
  hashes, expire after 24 hours and are returned exactly once. Consumption and
  final activation belong to the Telegram workflow module.

## Consequences

- The dashboard can resume safely after restart and show exactly why activation
  is blocked.
- Phase 0 credentials remain the same records and are selected by scope; no
  secret is copied into enrollment configuration.
- Phase 1 can be built without weakening the read-only Webbin boundary, while
  later modules can satisfy the remaining named checks through the same state
  machine.

## Verification

Tests cover Phase 0 scope adoption, uniqueness, optimistic concurrency,
idempotent replay, allowed and forbidden state transitions, strict locale/domain
validation, stale evidence, activation blocking, pairing-token hashing/expiry,
RLS isolation and atomic audit/outbox writes.
