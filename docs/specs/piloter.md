# Feature spec: Piloter

- Slug: `piloter`
- Status: Approved for implementation (core platform paths landed; see CHANGELOG)
- Primary type: `security_trust`
- Secondary types: `dashboard`, `workflow_kernel`, `integration`
- Date: 2026-09-03
- Owner: platform

## Problem

The project owner needs a **Piloter** helper who can run a **subset** of the
project’s already-enabled tools on Telegram without sharing the owner’s
Telegram identity. The owner must receive natural-language notices of what the
Piloter did, while existing owner-channel and tool behavior stay intact.

## Actor and outcome

- Actor: `platform_owner` assigns Piloter tools and issues pairing from the
  dashboard; Piloter acts only on Telegram; project owner remains the primary
  paired client on the same dedicated bot.
- Success criteria:
  - At most **one** Piloter per enrollment/project, optional.
  - Same dedicated client bot; two distinct Telegram conversations (owner vs
    Piloter), resolved by numeric user id and role.
  - Platform owner chooses a subset of tools already bound to the project;
    Piloter sees and runs only that subset with the **same tool UX** as the
    owner for those tools (including preview/cancel when the tool requires
    admin approval).
  - Owner receives **template** (non-LLM) NL notices of Piloter activity; for
    admin-approval tools, owner receives **only the successful final result**
    (no preview/cancel controls on the owner chat).
  - Requests and tickets record whether the actor was Owner or Piloter.
  - Concurrent owner and Piloter use does not cross-contaminate interview or
    request state.
  - Removing a tool from the Piloter subset **blocks new** Piloter requests for
    that tool; in-flight Piloter requests may finish.
- Freeze (must not change):
  - Behavior and results of existing tools/executors for the owner.
  - Owner Telegram channel semantics for the owner’s own requests.
  - No second client bot; ADR-0007 dedicated-bot topology remains.
  - No new capability ids or project profiles (`astro_*` unchanged).
  - No LLM for owner Piloter notices; no new external providers.

## Behavior

### Identity and pairing

- Piloter is a **role/identity** on the enrollment, not a `projectProfile`.
- Platform owner issues a one-time Piloter pairing link from client detail
  (same deep-link pattern as owner pairing).
- Consumption binds Telegram numeric user id + chat to a Piloter membership on
  the same dedicated client bot and tenant/project.
- Owner pairing and enrollment activation remain owner-gated; Piloter pairing
  does not replace the owner identity.

### Authorization

- Project capability bindings remain the project catalog (ADR-0020).
- Piloter additionally has an allowlisted **subset** of those enabled
  capability ids. Authorization for Piloter checks project binding **and**
  subset membership before listing or starting a tool.
- Owner authorization is unchanged (full project-enabled catalog).
- ADR-0042: no wider shared-port defaults; isolation is by actor identity, not
  by forking executors.

### Notifications

- Owner notices use localized **templates** only (no model call).
- Successful Piloter tool completion notifies the owner chat.
- For tools with admin approval: Piloter handles preview/cancel in the Piloter
  chat; owner is notified only on successful final outcome.

### Tickets and attribution

- Durable actor attribution Owner | Piloter on requests and tickets (and
  activities as needed for admin visibility).
- Enrollment- and ticket-scoped admin DMs default to the **owner** paired chat
  unless a message is explicitly scoped to another paired identity.
- Client notification delivery must resolve destination by `userId` / role —
  never an arbitrary project `.limit(1)` when two identities exist.

### Failure modes

- Unpaired Telegram user on the client bot → access denied (unchanged).
- Piloter invokes a tool outside subset → unavailable / denied; no execution.
- Subset empties or tool revoked mid-flight → open request may complete; new
  starts for that tool are blocked.
- Outbox cannot resolve owner chat for a Piloter notice → fail closed / retry
  per existing outbox rules; do not deliver to Piloter chat by mistake.

### In scope

- Schema/API/dashboard/workflow changes for second identity, subset, actor,
  outbox targeting, and owner template notices (implementation phase).
- Docs and ADR-0057 (this governance phase).

### Out of scope

- Multiple Piloters per enrollment.
- Shared client bot across tenants; Telegram groups/channels.
- New tools, stacks, or LLM-authored owner copy.
- Client dashboard for Piloter self-service.
- Second bot credential per Piloter.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 3 rule change (SCOPE/PRODUCT/TELEGRAM/SECURITY + ADR-0057) | Approve | 2026-09-03 |
| Same bot, two conversations | Confirm | 2026-09-03 |
| Templates for owner NL (no LLM) | Confirm | 2026-09-03 |
| One Piloter; pairing link (A); revoke blocks new only | Confirm | 2026-09-03 |
| No extra security limits beyond subset + pairing + actor | Confirm | 2026-09-03 |

## Documentation impact assessment

Required by [`AGENTS.md`](../../AGENTS.md):

- Canonical documents changed: `SCOPE.md`, `PRODUCT.md`, `MVP.md`,
  `ROADMAP.md`, `ARCHITECTURE.md`, `TELEGRAM.md`, `ONBOARDING.md`,
  `ENROLLMENT.md`, `SECURITY.md`, `DATA-MODEL.md`, `CONTRACTS.md`,
  `DASHBOARD.md`, `WORKFLOWS.md`, `OPERATIONS.md`, `TESTING.md`,
  `GLOSSARY.md`, `DECISIONS.md`, `CHANGELOG.md`, `adr/README.md`, this spec.
- ADRs added: **ADR-0057** (Accepted). Confirmed unchanged: **ADR-0007**.
  Related (not rewritten): ADR-0020, ADR-0025, ADR-0027, ADR-0042, ADR-0043,
  ADR-0054, ADR-0055 — behavior extensions documented in ADR-0057 and canon.
- Public contracts, schemas, states, permissions: pairing-link by role;
  Piloter subset read/write; actor on requests/tickets; outbox destination
  rules; dashboard Piloter panel.
- Migration or rollback documentation: schema lift of one-user uniqueness and
  new subset/actor fields — documented under OPERATIONS/DATA-MODEL when
  implementation lands; this phase records the target model only.
- Tests: dual-chat concurrency, subset enforcement, outbox targeting,
  revoke-blocks-new (TESTING.md).

## Compatibility

- Tools / executorIds / ports affected: all project-bound capabilities may be
  assigned to the Piloter subset; executors unchanged.
- ADR-0042: authorize by actor before executor; no dual defaults on shared
  ports.
- Impact Report summary: Product/SCOPE/MVP/SECURITY/TELEGRAM =
  `rule_change` (approved); architecture trust = `docs_gap` filled by
  ADR-0057; tool catalog = compatible with mitigated `tool_risk`.

## Handoff

- Next skill / mode: **Agent implementation plan** (not `create-tool`).
- Ordered tasks after this spec:

1. Schema: allow owner + optional Piloter per enrollment; membership role;
   subset binding store; request/ticket actor; second `channel_identities`
   row on the same client bot.
2. Pairing API + consume path for `role=piloter`; enrollment activation remains
   owner-pairing gated.
3. Authz: filter `listEnabledCapabilities` / `/tools` / start paths by Piloter
   subset; owner path unchanged.
4. Outbox: resolve chat by `userId`/role; owner template notices on Piloter
   success; enrollment/ticket DMs default to owner.
5. Dashboard: Piloter pairing link + subset panel on client detail.
6. Tests: concurrent owner+Piloter requests; subset deny; outbox targeting;
   revoke tool blocks only new Piloter starts.

## References

- ADR: [0057-piloter-role-and-capability-subset.md](../adr/0057-piloter-role-and-capability-subset.md)
- Topology: [0007-telegram-topology.md](../adr/0007-telegram-topology.md)
- Related: ADR-0020, ADR-0027, ADR-0043, ADR-0054, ADR-0055
- Canon: [TELEGRAM.md](../TELEGRAM.md), [SCOPE.md](../SCOPE.md),
  [SECURITY.md](../SECURITY.md)
