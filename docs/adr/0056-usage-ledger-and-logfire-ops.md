# ADR-0056: Usage ledger for Analytics KPIs and Logfire for ops telemetry

- Status: Accepted
- Date: 2026-08-31
- Supersedes: None
- Superseded by: None
- Extends: [0003](0003-postgresql-and-redis.md), [0010](0010-local-first-production-ready.md), [0019](0019-versioned-project-manifest-and-budget-policy.md), [0044](0044-dashboard-dark-design-system.md)

## Context

Dashboard Analytics documents cost and latency panels as **Available soon** until
`GET /api/v1/usage` exists. Workers already persist `model_calls` and
`usage_records`. Separately, operators want packaged local observability via
Pydantic Logfire (OpenTelemetry). Confusing those layers would either invent
KPI numbers from traces or put multi-tenant cost accounting in a SaaS that is
not Binflow’s durable source of truth.

## Decision

1. **Postgres is the durable usage ledger.** `model_calls` and `usage_records`
   (plus project budget ceilings where needed) are the only source for
   Analytics spend, tokens, call counts, latency aggregates, budget alerts, and
   efficiency scores. `GET /api/v1/usage` aggregates them for platform-owner
   sessions with the same date-range semantics as Analytics
   (`24h` | `7d` | `30d` | `all`).
2. **Logfire is ops-only.** Optional OpenTelemetry export from `api` and
   `worker` to a **single platform** Logfire project. Spans may carry
   allowlisted attributes (`tenantId`, `projectId`, `requestId`, node/
   capability identifiers, route class, durations). They must not carry
   secrets, prompt/attachment bodies, cookies, or decrypted credentials.
3. **Analytics never queries Logfire.** Logfire never feeds KPI cards. The UI
   still forbids invented mock dollars.
4. **Env-gated, local-first.** Export is enabled only when `LOGFIRE_TOKEN` (or
   the documented equivalent) is set. Absent the token, runtime behavior matches
   pre-instrumentation processes.
5. **Freeze:** No behavior change to tools/executors, Telegram workflows,
   approvals, or request state transitions. Live request-derived Analytics
   panels keep existing formulas; only previously-Soon fields consume Usage.

## Consequences

- Operators get real cost/latency KPIs without waiting on Logfire.
- Ops debugging gains traces without making Logfire a multi-tenant ledger.
- A new platform secret (Logfire write token) must be handled like other
  runtime secrets and never committed.
- Budget alert and efficiency panels use real rows only; empty means empty.

## Alternatives considered

- Logfire-only Analytics: rejected; not durable, not tenant-ledger, invents
  product dependency on external query UX.
- Usage API without Logfire in the same delivery: rejected by product
  interview (both layers required); Logfire remains optional at runtime via env.
- Per-tenant Logfire projects: rejected for MVP; one platform project with
  tenant attributes is enough locally.

## Verification

- Contract and API tests for `GET /api/v1/usage` aggregations.
- Dashboard metrics tests: Soon panels become Live from Usage fixtures; Live
  request panels unchanged without Usage.
- Without `LOGFIRE_TOKEN`, api/worker tests and tool/workflow suites pass with
  no egress.
- With token in local ops docs only; redaction rules covered in SECURITY tests
  or explicit allowlist review.
