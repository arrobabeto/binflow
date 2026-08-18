# ADR-0015: Administrative ingress and scoped database execution

- Status: Accepted
- Date: 2026-08-17
- Supersedes: None
- Superseded by: None

## Context

Phase 1 adds an authenticated Nuxt dashboard, a Fastify business API and
platform-wide administrative reads across tenant-owned data. Better Auth needs
to own its HTTP session lifecycle without making the dashboard server a second
business API. PostgreSQL RLS also cannot protect data when application code can
use an unscoped or privileged connection implicitly.

Administrative mutations additionally need one stable retry contract. Browser
retries, duplicate callbacks and lost HTTP responses must not create duplicate
enrollments, validation jobs or external operations.

## Decision

Nuxt owns `/api/auth/**` and Better Auth session endpoints. Fastify owns
`/api/v1/**` and all business authorization. Both runtimes use the shared
`@binflow/auth` package to interpret the same server-side session; the browser
uses same-origin paths and never supplies a tenant identifier as authority.

Fastify maps an authenticated identity to a domain actor and opens exactly one
explicit database execution scope for each application operation:

- `tenant`: sets `app.tenant_id` and clears `app.platform_owner` with
  transaction-local PostgreSQL settings.
- `platform_owner`: sets `app.platform_owner = true`, requires an authenticated
  platform owner and records the administrative reason and actor in audit.
- `system`: is available only to named worker/maintenance operations and still
  requires an explicit tenant or allowlisted cross-tenant job contract.

Repositories receive a scoped transaction handle, not an ambient raw database
client. Runtime services use a PostgreSQL role without superuser, table-owner or
`BYPASSRLS` authority. Schema migration uses a separate owner credential.
Tenant-owned tables enable and force RLS where PostgreSQL permits it.

Every `/api/v1` mutation requires an `Idempotency-Key` and the expected resource
version. HTTP resources expose a strong version ETag and mutations use
`If-Match`. The idempotency key is bound to actor, route, method and a canonical
request hash. Reuse with a different request is a conflict; reuse with the same
request returns the stored response or current operation reference.

Long-running administrative actions return `202 Accepted` with an immutable
operation ID. The originating business mutation, audit event and outbox event
commit in one PostgreSQL transaction. Queue publication happens after commit;
consumers deduplicate using their own stable processed-event key.

## Consequences

- Better Auth remains the authentication authority while Fastify remains the
  only business API.
- Platform-wide access is explicit and auditable rather than an RLS bypass hidden
  in repository code.
- Runtime database compromise does not automatically gain migration ownership
  or bypass RLS.
- Retried HTTP and queue delivery can be reconciled without duplicating business
  state.
- Local and production Compose require separate migration and runtime database
  credentials.

## Alternatives considered

- Put all business routes in Nuxt: rejected because it duplicates the Fastify
  application boundary and couples long-running operations to the UI runtime.
- Host Better Auth in Fastify: rejected because the accepted dashboard boundary
  owns auth routes and the official Nuxt integration provides the required
  cookie/SSR lifecycle.
- Use one privileged PostgreSQL role and rely only on repository filters:
  rejected because one missed filter becomes a cross-tenant disclosure.
- Treat BullMQ job IDs as the only idempotency record: rejected because Redis is
  transient and cannot prove the committed business response.

## Verification

- Route tests prove `/api/auth/**` and `/api/v1/**` have distinct owners while
  sharing one session interpretation.
- PostgreSQL tests use a non-owner runtime role and prove tenant isolation,
  platform-owner auditing and rejection of unscoped repository execution.
- Concurrent identical mutations return one result; key reuse with a different
  body returns `conflict_error`.
- Transaction rollback removes the business row, audit event and outbox event
  together; duplicate outbox delivery is processed once.
