# ADR-0003: PostgreSQL durable state and Redis coordination

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

Requests and approvals must survive restarts. Queue delivery, locks and rate limits need low-latency coordination but cannot be the only record of business state.

## Decision

PostgreSQL is the durable source for domain state, audit, events and workflow checkpoints. Redis is limited to queue transport, Chat SDK state, locks, rate limits and short-lived deduplication. S3-compatible storage holds large artifacts.

## Consequences

- Redis loss delays work but cannot erase accepted requests/approvals.
- PostgreSQL backup/restore is critical operations work.
- Transactional outbox bridges database state and queue delivery.
- Tenant-owned domain tables use explicit tenant scope and RLS.

## Alternatives considered

- Redis-only workflow state: rejected for durability and audit.
- Queue-as-source-of-truth: rejected because delivery semantics do not model business state.
- Store large binaries in PostgreSQL: rejected for backup and database growth costs.

## Verification

Integration tests remove/restart Redis and confirm requests resume from PostgreSQL without duplicate side effects.
