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
- Required Docker packaging from Phase 0 with shared local/VPS-ready application images.
- Added the Phase 0 draft scope bootstrap contract required before encrypted credentials can be tenant/project scoped.
- Added the executable TypeScript monorepo, CI skeleton, API health endpoint, worker/maintenance shells, Nuxt dashboard shell and local/production Docker definitions.
- Added the first shared domain/contracts packages and authenticated AES-256-GCM envelope implementation.
- Added initial PostgreSQL migrations, UUIDv7 records, tenant RLS policies, encrypted credential lifecycle storage and the Phase 0 scope/credential CLI commands.
- Added the Chat SDK Telegram/Redis runtime boundary and an in-memory messaging fake without enabling real bot handlers.
- Runtime containers execute compiled Node entrypoints as a non-root user and do not invoke package managers at startup.

### Changed

- Moved SecretsProvider and initial credential setup from Phase 1 into Phase 0; Phase 1 dashboard management reuses the same application services.
- Reconciled GitHub security and integration documentation with the registered permission ceiling while preserving least privilege for normal runtime tokens.
