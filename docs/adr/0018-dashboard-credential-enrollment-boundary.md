# ADR-0018: Dashboard credential enrollment boundary

- Status: Accepted
- Date: 2026-08-18
- Supersedes: None
- Superseded by: None

## Context

Phase 1 must manage the Phase 0 provider credentials from the authenticated
dashboard without creating a second storage path or exposing plaintext through
browser reads, logs, idempotency records, audit or queues. Verification must
continue to use the accepted candidate lifecycle and read-only adapters.

## Decision

- The dashboard may submit a provider secret once to the same-origin Fastify API
  over local HTTP during development or TLS in production. Every create, verify
  and revoke action requires a fresh TOTP-backed platform-owner session,
  `Idempotency-Key` and JSON content type; existing-credential actions also
  require the current strong ETag.
- Fastify is the only web process that receives the credential payload. Nuxt
  proxies the request without persisting it. Request bodies and secret-bearing
  validation errors are never logged or echoed.
- The API process receives the external SecretsProvider KEK as a read-only
  runtime secret. The dashboard process does not receive it. Local CLI and API
  use the same KEK and encrypted credential records.
- Candidate creation normalizes the strict provider-specific input, converts the
  secret bundle to a bounded buffer, envelope-encrypts it and clears plaintext
  and KEK buffers in `finally` paths. Its idempotency hash binds the secret using
  HMAC-SHA-256 under the KEK; neither plaintext nor an unkeyed secret hash is
  persisted.
- Responses contain only credential ID, kind, owner/binding scope, alias, masked
  suffix, lifecycle status, credential version, resource revision and health
  timestamps. Ciphertext, encryption metadata, safe provider configuration and
  verification evidence remain server-side.
- Verification invokes the existing `CredentialVerificationService` and provider
  adapters. It remains externally read-only. Revocation is explicit and
  idempotent. Rotation is candidate creation for the same immutable owner scope;
  successful verification supersedes the prior healthy version.
- Credential resources have a separate optimistic `revision`. Status/test/revoke
  changes increment it; immutable credential `version` continues to identify the
  candidate generation.
- The tenant-owned Telegram client credential is resolved directly by tenant.
  The first-MVP one-project enrollment does not invent a project connection for
  that bot.

## Consequences

- The browser can complete credential onboarding without receiving a stored
  secret back from the server.
- API compromise has access to the KEK while the process is running; dashboard
  compromise alone does not. Production therefore isolates API/dashboard
  containers and mounts the KEK only into API, worker and maintenance roles that
  require it.
- GitHub PEM selection in the browser cannot enforce host filesystem `0600`;
  instead the browser reads the explicitly selected file once, the API bounds and
  validates its PEM content, and no path is transmitted. CLI import retains its
  stronger filesystem checks.

## Verification

Tests prove strict provider unions, secret-free responses/events/idempotency,
keyed request fingerprints, KEK buffer clearing, fresh-session/ETag guards,
candidate rotation safety, read-only provider verification, revoke concurrency,
runtime-secret permission handling and tenant-scoped client-bot resolution.
