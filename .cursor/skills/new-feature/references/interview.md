# New-feature interview (Phase 0)

Run **one phase at a time**. After each phase, summarize decisions in a short
bullet list and **wait for user confirmation** before the next phase.

Do not invent product scope. Prefer quoting the user’s words in the summary.

## Phase A — Problem and outcome

Ask:

1. What problem does this solve, in one sentence?
2. Who is the primary actor? (`platform_owner` | `client` | `operator` | `system`)
3. What does success look like when the feature is done?
4. What must **not** change (freeze list)?

## Phase B — Surface and mutation

Ask:

1. Does it mutate durable request/enrollment/catalog state? Which entities?
2. Does the LLM interpret or generate? If yes, what is forbidden to the model?
3. External providers? (GitHub, Vercel, Telegram, OpenAI, other)
4. Client-facing channel? (Telegram command/NL, dashboard only, API only)
5. Approvals needed? (client, admin, both, none)

## Phase C — Catalog and tenancy

Ask:

1. New **project profile** or **tool stack**? Name candidates (e.g. `astro_repo`).
2. New **capability/tool** ids, or only platform plumbing?
3. Which existing tools/executors might share ports or code?
4. Multi-tenant? Which enrollment/activation steps change?

## Phase D — Scope and governance

Ask:

1. Is this inside current [`docs/SCOPE.md`](../../../../docs/SCOPE.md) /
   [`docs/MVP.md`](../../../../docs/MVP.md)? If not, is a scope expansion intended?
2. Known ADR that might conflict? (agent should also search `docs/adr/`)
3. Security/trust-boundary change? (auth, secrets, webhooks, destructive ops)
4. Urgency: docs-only gate now, or full feature brief for near-term build?

## Phase E — Confirmation package

Present a single block for user OK:

```markdown
### Feature recognition summary
- Problem:
- Actor:
- Outcome:
- Freeze:
- Mutates:
- LLM / providers:
- Stack/profile / capability:
- In SCOPE/MVP: yes | no | unclear
- Suspected primary type: (from Phase 1 list)
```

On confirmation → Phase 1 classification in `SKILL.md`.
