# Documentation and product changelog

All notable changes to product behavior, architecture, contracts, security, operations and scope are recorded here. This is not a substitute for detailed canonical documents or ADRs.

## Unreleased

### Added

- Established the documentation-first repository baseline.
- Defined the product, MVP, architecture, contracts, workflow, security, data, Telegram, integrations, testing, operations and phased roadmap.
- Recorded the initial architectural decisions and documentation Definition of Done.
- Fixed Node.js 24 LTS as the Phase 0 implementation baseline.
- Defined the Phase 0 interactive credential CLI and envelope-encrypted SecretsProvider contract.
- Added ADR-0013 for the explicitly approved GitHub App administrative registration ceiling, Webbin-only installation and per-operation token downscoping.
- Added ADR-0014 defining platform/tenant/project credential ownership, public configuration versus encrypted bundles, candidate activation/rollback and read-only provider verification.
- Added an integration application-service boundary so the CLI and later dashboard share credential verification and lifecycle behavior.
- Required Docker packaging from Phase 0 with shared local/VPS-ready application images.
- Added the Phase 0 draft scope bootstrap contract required before encrypted credentials can be tenant/project scoped.
- Added the executable TypeScript monorepo, CI skeleton, API health endpoint, worker/maintenance shells, Nuxt dashboard shell and local/production Docker definitions.
- Added the first shared domain/contracts packages and authenticated AES-256-GCM envelope implementation.
- Added initial PostgreSQL migrations, UUIDv7 records, tenant RLS policies, encrypted credential lifecycle storage and the Phase 0 scope/credential CLI commands.
- Added read-only Phase 0 credential verification for OpenAI model visibility, Telegram bot identity/transport and the Webbin-only GitHub App installation, including candidate activation and rollback tests against isolated PostgreSQL.
- Added read-only Vercel identity/project verification for the exact Webbin GitHub link and production branch.
- Added secure interactive GitHub PEM file import with repository-boundary, regular-file, size and `0600` permission checks.
- Added the Chat SDK Telegram/Redis runtime boundary and an in-memory messaging fake without enabling real bot handlers.
- Runtime containers execute compiled Node entrypoints as a non-root user and do not invoke package managers at startup.
- Added ADR-0015 and the Phase 1 control-plane foundation contracts for
  same-origin auth/business ingress, explicit database scopes, optimistic
  concurrency, durable idempotency, administrative operations and transactional
  outbox delivery.
- Serialized concurrent schema migration runners with a PostgreSQL advisory lock.
- Added ADR-0016 and the documented administrative authentication contract:
  single-owner interactive bootstrap, disabled public sign-up, mandatory TOTP,
  single-use backup codes, database-backed rate limits and fresh-session gates.
- Removed top-level await from the migration executable so the shared database
  package remains bundle-safe for the Nuxt authentication server runtime.
- Added the Better Auth server runtime, sole-owner CLI bootstrap, Nuxt login,
  TOTP enrollment/challenge, one-time backup-code display, session management
  and the authenticated Fastify session bridge.
- Revoked all dormant password-only sessions when initial TOTP enrollment
  completes so they cannot inherit two-factor assurance retroactively.
- Serialized root workspace test tasks that share the disposable PostgreSQL
  database, preventing cross-package fixture cleanup races.
- Aligned the Nuxt server bundle target with the pinned Node.js 24 runtime so
  modern dependency syntax is preserved without an incompatible ES2019 pass.
- Added dashboard/auth readiness checks and made the production Caddy service
  wait for a healthy dashboard rather than only a started process.
- Added ADR-0017 and the strict resumable enrollment/activation-evidence
  contract, including Phase 0 scope adoption, fail-closed mutable validations
  and hash-only one-time pairing links.
- Added the enrollment database aggregate, immutable dependency-fingerprinted
  validation attempts, pairing-token hashes, transactional audit/outbox events
  and tenant/project constraints in migration `0009`.
- Added the authenticated enrollment API and English dashboard screens for
  client creation, resumable configuration, credential readiness validation
  and one-time Telegram pairing-link delivery.
- Added redacted pairing idempotency receipts so retries never persist or
  redisplay the one-time plaintext token.
- Included the onboarding workspace in the shared Docker dependency layer so
  the same application image builds locally and for the future VPS release.

### Changed

- Removed a duplicate auth-schema re-export with no observable contract change.

- Replaced the AMD64-only ClamAV container with the official pinned Debian
  multi-architecture image so local Apple Silicon and production AMD64 hosts
  use the same native Compose service.
- Moved SecretsProvider and initial credential setup from Phase 1 into Phase 0; Phase 1 dashboard management reuses the same application services.
- Reconciled GitHub security and integration documentation with the registered permission ceiling while preserving least privilege for normal runtime tokens.
- Corrected the GitHub App private key to platform scope with a separate Webbin installation binding and narrowly defined the read-only installation-audit token exception.
- Required tenant-qualified project selection in Phase 0 commands so tenant-local project keys cannot resolve across ownership boundaries.
- Extended the shared Docker dependency stage to include every provider/integration workspace added in this slice.
- Made migration `0002` preserve but revoke all legacy credential shapes so upgrade remains executable without decrypting or silently reinterpreting old ciphertext; operators re-enroll required providers afterward.
- Added deterministic migration revocation audit events, verified-at/external-ID backfill and composite credential/secret project ownership constraints.
- Added strict evidence allowlists, serialized/stale-safe activation, composite tenant/project bindings and globally unique active Telegram bot identities.
- Restricted Phase 0 Webbin bindings to the internal `webbin/webbin` project, made attempt persistence monotonic and allowed same-binding Telegram bot rotation without weakening cross-binding uniqueness.
- Made type-aware lint depend on upstream workspace builds so clean CI checkouts resolve internal package declarations deterministically.
- Scoped the runtime-secret ignore rule to the repository root so the required `packages/secrets` workspace is tracked and available in clean CI checkouts, with a lockfile-to-tracked-manifest CI regression check.
