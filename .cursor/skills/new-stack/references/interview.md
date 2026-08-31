# New-stack interview (Phase 0)

Run one phase at a time. Summarize answers, then wait for user confirmation
before the next phase.

## Phase A — Identity

1. Working title / slug for the spec?
2. Stack catalog id (hyphenated, e.g. `astro-orbitype`)?
3. Project profile enum (underscored, e.g. `astro_orbitype`)?
4. Is this profile **selectable for enrollment now**, or only reserved in the
   enum for later?
5. Which existing stacks/profiles must stay frozen (default: all live ones,
   especially `astro_repo` / Webbin tools)?

## Phase B — Outcome and actors

1. Who operates enrollment (`platform_owner`)?
2. Success criteria for enrollment-only vs later tools?
3. May the enrollment reach `ACTIVE` with **zero** capability bindings?
4. First capability planned later (id) or explicitly deferred?

## Phase C — Providers and trust

1. Required providers: GitHub App, Vercel, OpenAI, Telegram client, other?
2. New credential kind / verifier? Read-only verify constraints?
3. Secrets: what is encrypted vs non-secret configuration?
4. Any SECURITY / trust-boundary change (webhooks, SQL, MCP to LLM, etc.)?

## Phase D — Locales and overlays

1. Content locales subset of `en`/`es`/`de`?
2. Translation policy (`always_translate` vs `none` for monolingual)?
3. Any Webbin-style hard overlays (repo/branch/locales) that must **not** apply?

## Phase E — Scope and governance

1. Does SCOPE / MVP / ROADMAP need expansion? (`rule_change` if yes)
2. Does an accepted ADR need superseding?
3. ADR-0042: will first tools reuse GitHub/OpenAI/Vercel shared ports? If yes,
   scopes stay per-capability — no wider defaults.
4. Out of scope for this stack’s first ship (list explicitly).

## Phase F — Ops and enrollment smoke

1. Any special ops for local polling / webhooks?
2. Activation check names expected at Validate?
3. Confirm operator will use [`docs/ENROLLMENT.md`](../../../../docs/ENROLLMENT.md)
   section B after implementation.

After Phase F, fill [`templates/stack-brief.md`](templates/stack-brief.md) and
proceed to Impact.
