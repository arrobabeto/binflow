# ADR-0062: Hey Binn (`hey_binn`) — read-only Telegram advisor

- Status: Accepted
- Date: 2026-09-06
- Supersedes: None
- Superseded by: None
- Extends: [0042](0042-tool-isolation-and-shared-ports.md), [0055](0055-admin-tickets.md), [0056](0056-usage-ledger-and-logfire-ops.md)

## Context

Clients need help inventing and refining content ideas against their live site
knowledge, then preparing a strong input for an enabled tool. Today Binflow
offers catalog tools and `/open_ticket`, but no read-only conversational advisor.
A free-form coding agent would violate product and security boundaries; a
platform meta-command patterned on ADR-0055 can stay fail-closed if it never
mutates and never invokes tools.

## Decision

1. **Platform meta capability id `hey_binn`.** Available to every paired client
   on every stack by default. Listed in `/tools` and `/help`. Not assignable via
   Dashboard capability bindings (same class as `open_ticket`).
2. **Invocation:** slash `/hey_binn` and natural-language greetings that address
   Binn (e.g. Hola/Hi/Hallo/Hey Binn). Matcher must not steal unrelated tool
   intents.
3. **Read-only advisor.** Deterministic application code may load allowlisted
   project content (GitHub and, when enrolled, CMS read APIs) into model context.
   The LLM never receives shell, SQL, secret, merge, publish, or mutate tools.
4. **No workflow `requests` for the chat itself (v1).** Turns are ephemeral for
   conversation state. Model usage/cost is recorded for budgets and dashboard
   KPIs (extend ADR-0056 ledger as needed). Durable multi-session memory is out
   of scope until a later ADR.
5. **Handoff, not execution.** Binn may suggest an enabled tool or `/open_ticket`
   and, after explicit client approval in Telegram, emit a **typed message** for
   the client to use. The **client** starts the tool; Binn does not.
6. **No admin-in-the-loop** for Binn chat in v1.
7. **Dashboard Binn AI** (System nav, below Analytics): describe Binn, configured
   model, usage volume, per-client consumption, operator-visible rules, and
   behavior markdown sourced from code-owned docs/config.
8. **ADR-0042:** OpenAI and read ports used by Binn declare explicit
   `hey_binn` scope; shared factories must not widen defaults for content tools.

## Consequences

- Clients get ideation help without weakening mutate/approve invariants.
- Operators see Binn cost and rules without treating chat as a content request.
- Risk: over-broad repo reads into OpenAI — mitigate with allowlists, budgets,
  and redaction of secrets.
- Future session memory requires a superseding or extending ADR.

## Alternatives considered

- Catalog-assigned capability per project: rejected; must work on all stacks like
  `/open_ticket`.
- Durable `requests` per Binn session: rejected for v1 (user chose no request).
- Binn auto-starts tools: rejected; client must activate.
- Full coding agent with write tools: rejected (SCOPE permanent boundaries).

## Verification

- Ingress tests for `/hey_binn` and Binn greetings; negative cases for tool NL.
- Adapter tests: read ports never write; mutate ports absent from Binn tool map.
- Usage ledger rows attributable to `hey_binn` / project.
- Dashboard Binn AI contract/UI smoke; nav placement under System below Analytics.
- Regression: existing tool execute paths unchanged.
