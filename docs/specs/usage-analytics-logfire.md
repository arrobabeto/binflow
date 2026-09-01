# Feature spec: Usage Analytics + Logfire

- Slug: `usage-analytics-logfire`
- Status: Approved for implementation
- Primary type: `dashboard`
- Secondary types: `ops_deploy`, `integration` (Pydantic Logfire / OpenTelemetry)
- Date: 2026-08-31
- Owner: platform

## Problem

Analytics “Soon” cost/latency panels lack a durable Usage API. Local ops lack
packaged OpenTelemetry export to Logfire. Operators need both product KPIs and
ops traces without inventing dashboard numbers or changing tool behavior.

## Actor and outcome

- Actor: `platform_owner` / operator (Dashboard Analytics + Logfire UI).
- Success criteria:
  - All Analytics KPI panels that were Soon/Hybrid for spend/latency/alerts/
    efficiency become Live from Postgres via `GET /api/v1/usage`.
  - Local `api` and `worker` optionally export OTel spans to a **platform**
    Logfire project when a write token is present.
  - Analytics never reads Logfire; Logfire never replaces the usage ledger.
- Freeze (must not change):
  - Existing tools/executors, Telegram ingress/workflows, approvals, request
    state machine.
  - Live Analytics panels derived from `GET /api/v1/requests` (totals, tool
    usage/failures donuts, success-rate table call counts) keep the same
    formulas; only previously-Soon fields gain Usage data.
  - Logfire is off unless `LOGFIRE_TOKEN` (or documented equivalent) is set.

## Behavior

### Dual layer

| Layer | Store | Consumer | Purpose |
|---|---|---|---|
| Usage ledger | Postgres `model_calls` / `usage_records` (+ budgets) | `GET /api/v1/usage` → Analytics | Spend, tokens, calls, latency by client/tool/node/model/time |
| Ops telemetry | OpenTelemetry → Logfire cloud | Logfire UI | Traces, errors, latency debugging |

### In scope

- Implement `GET /api/v1/usage` (platform-owner session) with Analytics date
  ranges: `24h` | `7d` | `30d` | `all` (same semantics as Analytics request
  filters).
- Response dimensions: totals (spend, avg cost/request, avg latency), cost over
  time, cost/utilization by client, calls/cost/avg latency by capability
  (tool), by node, by model; budget-based cost alerts; efficiency scores from
  real cost/token/latency rows only (no invented dollars).
- Wire Analytics Soon/Hybrid spend/latency/alert/efficiency surfaces to Usage.
- Env-gated OTel instrumentation in `apps/api` and `apps/worker`; allowlisted
  span attributes only (`tenantId`, `projectId`, `requestId`, node/capability
  ids, HTTP route class, durations). Never secrets, prompt bodies, attachments,
  cookies, or decrypted credentials.
- One Logfire project for the platform; tenant/project as attributes.

### Out of scope

- New Telegram tools, catalog bindings, enrollment changes.
- Changing how model calls are authorized or executed (read/aggregate + optional
  spans only).
- Production Logfire rollout (local-first compose/host first).
- Feeding Analytics from Logfire queries.
- Commercial billing / credit balances.

### Failure modes

- Missing usage rows → zeros / empty series, not mock Figma values.
- Missing `LOGFIRE_TOKEN` → no OTel export; processes behave as today.
- Usage API auth failure → same session errors as other admin GETs.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 3 new ADR (dual-layer observability) | Approve | 2026-08-31 |
| Logfire platform project + both layers | Approve | 2026-08-31 |

## Documentation impact assessment

Required by [`AGENTS.md`](../../AGENTS.md):

- Canonical documents changed: `CONTRACTS.md`, `DASHBOARD.md`,
  `DESIGN-SYSTEM.md`, `SECURITY.md`, `OPERATIONS.md`, `DATA-MODEL.md` (touch if
  aggregation notes needed), `CHANGELOG.md`, `adr/README.md`.
- ADRs added: **ADR-0056**; confirmed unchanged: ADR-0003, ADR-0010, ADR-0019,
  ADR-0042, ADR-0044.
- Public contracts: `GET /api/v1/usage` response schema; dashboard Usage fetch.
- Migration or rollback: none required for read-side aggregation; OTel is
  env-gated with no schema change.

## Compatibility

- Tools / executorIds / ports affected: none (ADR-0042 N/A).
- Workflow kernel: freeze — no state transitions.

## Handoff

- Next: Agent implementation (API → contracts/tests → dashboard → Logfire).
- Ordered tasks:
  1. ADR-0056 + canonical docs (this gate).
  2. `GET /api/v1/usage` + contracts/tests.
  3. Analytics UI wiring (preserve Live request panels).
  4. Env-gated Logfire/OTel on api+worker.
  5. Verification suites; smoke without Logfire env.

## References

- ADR-0056, ADR-0019, ADR-0003, ADR-0010, ADR-0044
- `docs/DASHBOARD.md` Analytics table
