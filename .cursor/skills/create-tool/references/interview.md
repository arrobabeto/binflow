# Tool interview — phased question bank

Stop after each phase; show a summary; wait for user confirmation.

See also: `graph-by-mutation.md`, `client-facing-copy.md`, `post-ship-ops.md`.

## Phase 1 — Intent and trigger

- What user outcome does this tool deliver?
- Telegram command (`/snake_case`)? Natural-language cues?
- **NL:** infinitives **and** conjugations (`borra`, `elimina`, `delete`, …).
- If create + delete share a domain (blog): **delete must win** in dispatch order.
- Which stack/profile (`astro_repo`, …)? Written into brief `allowedProfiles`
  and migration `allowed_profiles` — only projects with that profile can be
  assigned the tool in the dashboard.
- Mutation class: `create` | `update` | `destructive` | `read_only`
- Risk class and preview required? (See `graph-by-mutation.md` defaults.)
- Reuse executor family: blog, project, or new?

## Phase 2 — Mutation semantics (critical for destructive)

Use `graph-by-mutation.md` — do **not** copy create-blog node names blindly.

- Preview / approval artefact: Vercel deploy vs PR head vs none?
- Who approves: client, admin, both?
- Production verification: route exists vs 404 vs **301 redirect**?
- Idempotency when target already deleted/updated?
- Rollback if merge succeeds but verification fails?
- `requiresPreview` explicit boolean in brief (destructive → usually `false`).

## Phase 3 — Reuse analysis

Compare against `create-blog` and `create-project` graphs:
- Which nodes can reuse `nodeKind` unchanged?
- Which need **new ids** (same GitHub op, different meaning → new node name)?
- Which validation stages are needed?
- Collection loop (`NEEDS_INPUT`) required?

## Phase 4 — Inputs and collection

- Base closed facts (code-owned) vs `content_schema` (customization)?
- Field types, asks, `requiredWhen` rules
- Reserved ids to avoid: `name`, `fecha`, `projectDescription`, …
- Image/url/boolean handling

## Phase 4b — Client-facing copy

See `client-facing-copy.md`.

- Plan confirm: what does the client see? (title + URL, not paths.)
- **Inline CTAs:** list every Telegram decision surface for this tool:
  - Plan confirm, target/URL confirm, preview (if any), revision (if any), cancel
- Per surface: **action token** + **label** in `es` / `en` / `de`
- Verify each label describes the **next action** the graph will run — not copy
  borrowed from create-blog (`Crear borrador` on delete is wrong)
- Admin notices: client key + natural action + PR + request id?
- Example messages per locale — good and bad (include button labels, not only body text)
- Record copy shapes and CTA table in brief `verification.scenarios` and spec §5

## Phase 5 — Layer assignment

For each behavior, assign **code**, **manifest**, or **customization**.
See `layers.md`. Flag antipatterns (paths in customization, models in markdown).

## Phase 6 — Graph, states, predicates

Read `graph-by-mutation.md` before finalizing nodes.

- Node list: id, kind, nodeKind, label, permissions — **coherent when read aloud**
- No `create_draft` / `wait_preview` on destructive tools
- Edges and `when` predicates (must be in `knownPredicates` or add to allowlist)
- Interrupt nodes: actor, ttlHours
- Agent nodes: model, effort, rulesRef vs local rules.md

## Phase 7 — Models and budget

- Model per agent node (from allowlist)
- Budget: maxModelCalls, maxTokens, maxEstimatedCostCents
- Timeout and retry policy

## Phase 8 — Errors and idempotency

- Typed error codes and when they fire
- Provider retryable vs final failures
- Outbox/job keys for resume

## Phase 9 — Verification and fixtures

- Scenario matrix entries for TESTING.md
- NL ingress test phrases per locale
- Fixture files under `packages/*/test/fixtures/`
- Operator scripts if any (rematerialize, upload customization)

## Phase 10 — Documentation plan

- New ADR needed? Amend existing? (Destructive → ADR-0040 gate.)
- Spec path, pilot customization, migration number
- Post-ship: migrate, default binding, rematerialize (`post-ship-ops.md`)
- Scope/MVP/ROADMAP impact?

## Output

Write `packages/tools/briefs/<id>.brief.yaml` using the schema in
`packages/tools/src/tool-brief.ts`.
