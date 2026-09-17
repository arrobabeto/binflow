# Feature spec: Hey Binn (`hey_binn`)

- Slug: `hey-binn`
- Status: Implemented
- Primary type: `capability`
- Secondary types: `dashboard`, `security_trust`
- Date: 2026-09-06
- Owner: platform
- Binding ADR: [ADR-0062](../adr/0062-hey-binn.md)

## Problem

Paired clients need help generating and clarifying content ideas, understanding
what already exists on their site, and preparing a strong input for an enabled
tool—without Binflow inventing a mutation or acting as a general coding agent.

## Actor and outcome

- Actor: `client` (dedicated Telegram bot); `platform_owner` observes Binn via
  dashboard **Binn AI**.
- Success criteria:
  - Invoke with `/hey_binn` or natural greetings (Hola/Hi/Hallo/Hey Binn, etc.).
  - Bidirectional natural-language chat; Binn reads tenant site/repo context via
    deterministic read-only ports.
  - Suggest an enabled tool (or `/open_ticket`); after client approval, deliver a
    **typed message** the client can paste/use when they activate the tool.
  - Client activates the tool; Binn never invokes tools or mutates content.
  - v1: no conversation memory across turns beyond the live chat thread handling
    chosen at implementation (no durable session store).
  - Platform meta: all stacks, default on, listed in `/tools` and `/help`, not
    dashboard-assignable (same class as `/open_ticket`).
  - Dashboard **Binn AI** under System (below Analytics): model, usage volume,
    per-client consumption, rules display, behavior markdown.
- Freeze:
  - Existing content tools’ execute/approve paths unchanged.
  - No GitHub/CMS/Vercel write from Binn.
  - No admin-in-the-loop for Binn chat.
  - PRODUCT boundary: not a general coding agent or NL shell.

## Behavior

### In scope

- Platform command `hey_binn` / `/hey_binn` + NL greetings.
- OpenAI chat with project-scoped credential and budget (ADR-0042 scope).
- Read-only access to enrolled project content (GitHub theme/site paths;
  Orbitype/CMS read when the profile has it)—allowlisted by deterministic code.
- Tool suggestion from the client’s enabled catalog (+ `/open_ticket`).
- Typed handoff message after client confirmation; client runs the tool.
- Usage/cost recording for Analytics-style KPIs without creating workflow
  `requests` for the chat itself.
- Dashboard Binn AI surface.

### Out of scope (v1)

- Durable conversation memory / multi-session context store.
- Binn invoking tools, opening tickets, merging, publishing, or writing files.
- Admin Telegram approval of Binn turns.
- Client dashboard; voice; shared bots.
- Image *generation* providers beyond describing/suggesting (if image help is
  offered, it is advisory or routes the client to an enabled image tool).

### Failure modes

- Unpaired user → existing pairing rules.
- Missing OpenAI / GitHub read binding → fail closed with clear copy.
- Over-broad NL → Binn matcher only on explicit Binn greetings/command; do not
  steal unrelated tool intents.
- Client rejects typed handoff → stay in chat or exit without starting a tool.

### Acceptance criteria

1. Every paired client sees `/hey_binn` in `/tools` and `/help` without capability
   assignment.
2. Chat never creates content PRs/CMS drafts.
3. Typed handoff requires explicit client approval in-chat.
4. Dashboard Binn AI shows model, volume, per-client spend/usage, rules, MD.
5. Astro/Shopify tool regression suites unchanged for mutate paths.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 3 SCOPE/PRODUCT/ROADMAP expansion + ADR-0062 | Approve | 2026-09-06 |

## Documentation impact assessment

Required by [`AGENTS.md`](../../AGENTS.md):

- Canonical documents: `PRODUCT.md`, `SCOPE.md`, `ROADMAP.md`, `ARCHITECTURE.md`,
  `CONTRACTS.md`, `WORKFLOWS.md`, `SECURITY.md`, `DATA-MODEL.md`, `DASHBOARD.md`,
  `TELEGRAM.md`, `INTEGRATIONS.md`, `TESTING.md`, `OPERATIONS.md`, `GLOSSARY.md`,
  `CHANGELOG.md`, `DECISIONS.md`, `adr/README.md`, this spec.
- ADRs: **ADR-0062** added. Confirmed unchanged: ADR-0042, ADR-0055 (pattern
  cited, not superseded), ADR-0056 (usage ledger may be extended).
- Public contracts: Telegram commands/actions; optional usage API for Binn AI;
  no new mutate graph states.
- Migration: usage/event table or ledger extension if required at implement time;
  document in OPERATIONS.
- Tests: ingress NL, fail-closed reads, no-write assertions, dashboard contract
  stubs.

## Compatibility

- Tools: all catalog tools + `open_ticket` — NL isolation; Binn suggests only.
- Ports: OpenAI + GitHub/CMS **read** scoped to `hey_binn` (ADR-0042).
- Impact Report: Phase 2 of new-feature (2026-09-06).

## Handoff

- Next: **Agent implementation plan** (not classic create-tool mutate scaffold).
- Ordered tasks after this spec:

1. Contracts + Telegram ingress (`/hey_binn`, NL).
2. Read-only context ports + OpenAI advisor loop (no session DB v1).
3. Typed handoff UX + usage ledger hooks.
4. Dashboard Binn AI page + nav.
5. Tests + OPERATIONS migrate notes.
