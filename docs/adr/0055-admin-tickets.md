# ADR-0055: Admin tickets for out-of-catalog client requests

- Status: Accepted
- Date: 2026-08-31
- Supersedes: None
- Superseded by: None
- Extends: [0043](0043-admin-client-direct-messages.md), [0027](0027-client-notification-outbox.md)

## Context

Clients sometimes ask for work that is not an enabled catalog capability.
Those messages must not invent a tool run. Platform owners need a durable
**ticket** queue in the dashboard to track custom requests, mark them read,
change lifecycle state, and optionally message the client. Clients need a
Telegram path to open those tickets without assigning a catalog capability.

## Decision

1. Tickets are tenant/project-scoped rows with states
   `new` (default), `in_process`, `declined`, `closed`.
2. Dashboard **Pending** lists `new` and `in_process`. **History** lists
   `declined` and `closed`. “Mark as resolved” sets `closed` (Figma “Resolved”
   is not a separate state).
3. Unread means `readAt` is null. Opening detail calls an idempotent mark-read.
4. Platform-owner API: list (tab/client/state/cursor), get, patch state/notes,
   mark read, message-target, messages.
5. **Telegram ingest (platform, all clients/stacks):**
   - Unmatched client messages offer custom request vs `/tools` (not a dead-end).
   - `/open_ticket` starts a non-catalog interview on the client bot (also listed
     in `/tools` and `/help`). Durable collection uses `capabilityId: open_ticket`
     without a Dashboard capability binding.
   - Interview gathers requirement, scope, intent, urgency, and kind
     (improvement / style / bug). An LLM produces a client-facing summary and
     effort/time estimate only (no shell, publish, or provider mutation tools).
   - Client confirms send → `TicketService.createTicket` (`state: new`) and a
     short **text-only** `admin.notification_requested` card; or cancel.
   - Greeting/thanks phrases use a **heuristic** polite reply (no LLM).
6. Ticket-scoped admin→client messages reuse `client.notification_requested`
   with `aggregateType: ticket` and `notificationType: admin.ticket_message`
   (ADR-0043 extended). Destination chat IDs stay out of the payload; the
   worker resolves pairing by the ticket’s tenant/project.

## Consequences

- Custom asks are visible without inventing capabilities.
- Messaging stays the same audited outbox path as enrollment/request DMs.
- Every paired client can open tickets; operators are not required to bind a tool.

## Alternatives considered

- Folding tickets into workflow requests: rejected; requests for catalog tools
  are capability graph runs with approvals and publication.
- Fifth state `resolved`: rejected; map resolve → `closed`.
- Assignable catalog capability for tickets: rejected; must work on all stacks
  without Dashboard assignment.
- LLM for greetings: rejected; heuristics only.

## Verification

- Pending/history filters exclude the other tab’s states.
- Mark-read is idempotent; unread indicator clears after open.
- Ticket message enqueue uses aggregate `ticket` and delivers via project pairing.
- `/open_ticket` and unmatched fallback create tickets and admin text notices;
  greetings do not create tickets.
