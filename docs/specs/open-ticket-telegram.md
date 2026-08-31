# Feature spec: Telegram open ticket (client custom ask)

- Slug: `open-ticket-telegram`
- Status: Approved for implementation
- Primary type: `workflow_kernel`
- Secondary types: `integration` (Telegram + OpenAI estimate)
- Date: 2026-08-31
- Owner: platform

## Problem

When a paired client’s message does not match an enabled tool, Binflow only
replied “could not match…”. Clients had no path to file an out-of-catalog ask.
Greeting/thanks messages were treated as unknowns.

## Actor and outcome

- Actor: `client` (Telegram); admin receives ticket (Dashboard + short Telegram notice).
- Success criteria:
  - Unmatched ask offers **custom request** (`/open_ticket` flow) or **`/tools`**.
  - `/open_ticket` interview collects requirement, scope, intent, urgency, kind
    (improvement / style / bug); LLM produces a clear non-technical summary +
    effort/time estimate; client **sends** or **cancels**.
  - Send creates ADR-0055 ticket (`new`) and admin Telegram text notice.
  - Greetings/thanks get a short polite reply (heuristic, no LLM).
- Freeze: existing tool matching/executors; no GitHub/Vercel/Orbitype from this
  flow; ticket is not a catalog capability binding.

## Behavior

### In scope

- Platform command `/open_ticket` listed in `/tools` and `/help` for every paired
  client (all stacks); not assignable via Dashboard bindings.
- Fallback after unmatched NL/command path.
- Durable `requests` collection with `capabilityId: open_ticket` (platform-only).
- `TicketService.createTicket` + `admin.notification_requested` (text-only card).
- LLM estimate/summary only (no tools, no publication).

### Out of scope

- Assignable catalog tool / graph / preview / merge.
- Greeting via LLM.
- Admin Telegram action buttons on ticket-created notice.
- Changing ticket Dashboard UI (already shipped).

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 3 rule change (complete ADR-0055 Telegram ingest) | Approve | 2026-08-31 |

## Documentation impact assessment

- Canonical: `docs/TELEGRAM.md`, `docs/SCOPE.md`, `docs/CHANGELOG.md`,
  `docs/TESTING.md`, `docs/CONTRACTS.md` (reply actions), `docs/DASHBOARD.md` if needed.
- ADRs: amend **ADR-0055** (Telegram create + admin notice); confirm ADR-0043
  messaging unchanged; ADR-0054 `/tools` lists meta `/open_ticket`.
- Contracts: new Telegram reply actions; optional open-ticket collect input schema.
- Migration: none (tickets table exists).
- Tests: greeting heuristics, fallback CTAs, interview→createTicket, admin outbox.

## Compatibility

- Tools / ports: none shared with content executors (ADR-0042 N/A).
- Reuses `TicketService.createTicket`, admin outbox drain.

## Handoff

- Next: Agent implementation (this request).

## References

- ADR-0055, ADR-0043, ADR-0054
- `packages/workflows/src/tickets.ts`
