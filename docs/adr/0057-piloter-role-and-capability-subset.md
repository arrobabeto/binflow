# ADR-0057: Piloter role and capability subset on dedicated client bot

- Status: Accepted
- Date: 2026-09-03
- Supersedes: None
- Superseded by: None

## Context

Project owners need a helper (**Piloter**) who can run some of the project’s
enabled Telegram tools without sharing the owner’s Telegram identity. SCOPE and
product docs previously limited each enrollment to a single paired client user.
ADR-0007 already requires one **dedicated client bot per enrollment**; Telegram
supports multiple 1:1 chats on that bot. The gap is application identity,
authorization, notification targeting, and attribution—not a second bot.

Related accepted decisions that remain binding and are extended (not rewritten)
by this ADR: ADR-0020 (project capability bindings), ADR-0025 (delivered owner
pairing activates enrollment), ADR-0027 (client notification outbox), ADR-0042
(tool isolation / shared ports), ADR-0043 (admin→client DMs), ADR-0054 (tool
catalog), ADR-0055 (tickets).

## Decision

1. **Same dedicated client bot.** Tenant/project resolution remains bot
   identity (ADR-0007). Piloter and owner are distinct Telegram numeric user
   IDs and chats on that bot.

2. **Roles.** Each enrollment has exactly one primary client (**owner**) and
   may have at most **one** active **Piloter**. Piloter is a membership/channel
   role, not a `projectProfile` or new capability id.

3. **Pairing.** Platform owner issues a one-time Piloter pairing link from the
   dashboard (same hash-only, 24h, single-use pattern as owner pairing).
   Enrollment activation remains gated on owner pairing delivery evidence
   (ADR-0025). Piloter pairing does not replace or demote the owner.

4. **Capability subset.** Project bindings (ADR-0020) define the enabled
   catalog. Piloter may use only an allowlisted subset of those bindings.
   Owner retains the full project-enabled catalog. Authorization for Piloter
   checks project binding **and** subset membership before `/tools`, NL
   routing, or request creation. Executors and shared ports are unchanged
   (ADR-0042: no wider defaults).

5. **Tool UX.** For assigned tools, Piloter receives the same client UX as the
   owner, including preview/cancel when the capability requires admin
   approval.

6. **Owner notices.** On Piloter activity, the owner chat receives localized
   **template** messages (no LLM). For admin-approval tools, the owner is
   notified only of the **successful final result**, not preview/cancel
   controls.

7. **Attribution.** Requests and tickets record actor Owner | Piloter for
   audit and dashboard visibility.

8. **Outbox targeting.** Delivery resolves chat from the paired channel
   identity for the intended `userId` / role. Request-scoped notices already
   follow `requests.userId`. Enrollment- and ticket-scoped default targets are
   the **owner** identity when both exist. Implementations must not pick an
   arbitrary project identity via `.limit(1)` when multiple active identities
   are present (extends ADR-0027 / ADR-0043 operationally).

9. **Subset revocation.** Removing a capability from the Piloter subset blocks
   **new** Piloter starts for that tool; in-flight Piloter requests may
   complete.

10. **Concurrency.** Interview and “latest request” isolation remain per
    `userId` + project so owner and Piloter may operate concurrently without
    shared conversational state.

## Consequences

- SCOPE / PRODUCT / MVP / TELEGRAM / SECURITY expand to allow owner + optional
  Piloter on one dedicated bot; unlimited client users and multi-project
  enrollments remain out of first-MVP scope.
- Schema must lift “one client user per enrollment” uniqueness and store
  Piloter subset + actor fields.
- Dashboard gains Piloter pairing and subset assignment on client detail.
- Mis-targeted outbox delivery becomes a security regression class; tests must
  cover dual-identity routing.
- No second bot credential, no new tool executors, no LLM owner copy.

## Alternatives considered

- **Second dedicated bot per Piloter:** rejected — doubles credential/ops
  surface; ADR-0007 already isolates tenants by bot; two chats on one bot
  suffice.
- **Shared owner Telegram session / forwarded commands:** rejected — breaks
  identity attribution and allowlisting.
- **New project profile for Piloter:** rejected — Piloter is a role on an
  existing enrollment, not a stack.
- **LLM-generated owner notices:** rejected for v1 — templates only.
- **Cancel in-flight requests when subset shrinks:** rejected — product choice
  is block new starts only.

## Verification

- Pairing: Piloter link binds only the consuming Telegram user; wrong bot /
  replay / expiry denied; owner pairing still activates enrollment.
- Authz: Piloter `/tools` and starts respect subset; owner catalog unchanged;
  unbound or unbound-for-Piloter tools denied.
- Concurrency: simultaneous owner and Piloter collection steps do not share
  request state.
- Outbox: Piloter success notice reaches owner chat; enrollment/ticket admin
  DM defaults to owner; request-scoped notices reach the request actor.
- Revocation: after subset removal, new Piloter starts fail; open request may
  finish.
- ADR-0042: no shared-port default widened; sibling tools regression suite
  green for owner paths.

## See also

- Spec: [docs/specs/piloter.md](../specs/piloter.md)
- [ADR-0007](0007-telegram-topology.md)
- [ADR-0020](0020-code-owned-capability-catalog-and-project-binding.md)
- [ADR-0027](0027-client-notification-outbox.md)
- [ADR-0043](0043-admin-client-direct-messages.md)
- [ADR-0055](0055-admin-tickets.md)
