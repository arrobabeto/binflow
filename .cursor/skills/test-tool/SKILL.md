# Test Tool (client-realistic audit)

Post-ship audit of a Binflow capability from the **client perspective**: Telegram
copy, CTAs, state machine, graph semantics, and customization scope — not just
unit tests and conformance.

Use after [`create-tool`](../create-tool/SKILL.md) ships a tool, after UX/copy
changes, or when validating a client customization upload.

## Preconditions

1. Read `docs/README.md`, the tool spec (`docs/specs/<tool>.md`), and
   [`docs/TESTING.md`](../../../docs/TESTING.md). Include ADR-0042 when the
   tool syncs a content catalog (`catalog_sync` / shared GitHub port).
2. Read [`references/discovery-checklist.md`](references/discovery-checklist.md)
   before generating scenarios.
3. Do **not** edit the attached plan file.
4. Do **not** auto-modify product code unless the user asks for fixes after the audit.

## Invocation parameters (required before Phase 1)

Ask or infer these before running:

| Parameter | Values | Default |
|-----------|--------|---------|
| **`toolId`** | `create_blog_draft`, `delete_blog_draft`, `create_project_astro`, … | required |
| **`auditMode`** | `base` \| `customized` | `base` |
| **`clientKey`** | e.g. `webbin` | required if `auditMode=customized` |
| **`locale`** | `es` \| `en` \| `de` | `es` |
| **`depth`** | `smoke` \| `standard` \| `deep` | `standard` |
| **`environment`** | `offline` \| `local-live` | `local-live` if stack available; else `offline` |

See [`references/base-vs-custom.md`](references/base-vs-custom.md) for mode semantics.

## Phase 0 — Preconditions gate

Read in order:

1. `docs/specs/<tool>.md` and `packages/tools/briefs/<id>.brief.yaml`
2. Catalog: `packages/tools/stacks/.../tool.yaml`, `graph.yaml`, node yamls
3. [`docs/TELEGRAM.md`](../../../docs/TELEGRAM.md) and
   [`client-facing-copy.md`](../create-tool/references/client-facing-copy.md)
4. If `customized`: `docs/customizations/<client>-<tool>.md` + confirm active
   customization version in DB
5. [`docs/TESTING.md`](../../../docs/TESTING.md) rows for that capability

**Gate (`local-live` only):** tool assigned via dashboard/API, migrations applied,
worker + API running (`BINFLOW_LIVE_EXECUTION_ENABLED=true` for execute/publish).

## Phase 1 — Discovery

Run [`references/discovery-checklist.md`](references/discovery-checklist.md).

Output a one-page **Tool profile** table (mutation class, preview policy,
approval roles, Telegram surfaces, typed errors, manifest bindings, custom fields)
before generating scenarios.

## Phase 2 — Scenario matrix

Generate scenarios from [`references/scenario-generators.md`](references/scenario-generators.md):

- **A** — standard Telegram-exposed scenarios (all tools)
- **B** — overlays by `mutationClass` (`create`, `destructive`, `update`, `read_only`)
- **C** — policy / ADR overlays (admin-only, ADR-0040, etc.)
- **D** — customized-only (`content_schema` asks, scope)
- **E** — depth filter (`smoke` / `standard` / `deep`)

Each scenario: ID (`DEL-03`), Given/When/Then, expected state, expected client copy
(human title/URL only — no repo paths or UUIDs).

Cross-check with [`graph-by-mutation.md`](../create-tool/references/graph-by-mutation.md)
and [`client-facing-copy.md`](../create-tool/references/client-facing-copy.md).

## Phase 3 — Automated baseline (always)

Run and record results in the audit report:

```bash
pnpm --filter @binflow/tools test
pnpm --filter @binflow/workflows test
pnpm --filter @binflow/policies test
pnpm --filter @binflow/workflows exec vitest run test/capability-conformance.test.ts
```

Also run package tests for the executor family when relevant (`@binflow/blog`,
`@binflow/projects`, `@binflow/messaging`).

**Offline:** map Phase 2 scenarios to existing ingress/runtime tests; mark gaps
(scenario with no automated coverage).

## Phase 4 — Live client simulation

Follow [`references/live-playbook.md`](references/live-playbook.md).

Score each scenario with [`references/verification-rubric.md`](references/verification-rubric.md).

**`offline` mode:** trace `*-ingress.ts`, `*-runtime.ts`, messaging; mark scenarios
**unverified-live**.

## Phase 5 — Audit report

Write the report using [`references/report-template.md`](references/report-template.md).

Deliverables:

- Chat summary: pass count, blockers, top 5 actions
- Persistent report: `docs/audits/<toolId>[-<clientKey>]-<YYYY-MM-DD>.md`
  (propose commit; do not commit unless user asks)

Classify each finding by **layer** using [`layers.md`](../create-tool/references/layers.md):
`code`, `manifest`, or `customization`.

## Pipeline position

| When | Skill |
|------|-------|
| Before ship | `create-tool` |
| After ship / UX changes | **`test-tool`** |
| Node/model tuning | `edit-node-config` |

Does **not** replace conformance tests or [`docs/TESTING.md`](../../../docs/TESTING.md);
uses them as baseline and adds qualitative client-realistic judgment.

## Never

- Auto-generate and commit test code (suggest snippets only).
- Auto-heal stuck requests (document manual recovery per `docs/OPERATIONS.md`).
- Run E2E against production Webbin or modify the Webbin repo without explicit authorization.
- Upload or change client customizations in production from this skill.
- Replace Bugbot, security review, or conformance suite.
- Judge customization changes that widen deletion scope, paths, or approvals (ADR-0030).
- Expose repo paths, SHAs, or raw UUIDs in client-facing audit copy examples.
- Edit the attached plan file.

## References

- [`references/discovery-checklist.md`](references/discovery-checklist.md)
- [`references/scenario-generators.md`](references/scenario-generators.md)
- [`references/verification-rubric.md`](references/verification-rubric.md)
- [`references/live-playbook.md`](references/live-playbook.md)
- [`references/report-template.md`](references/report-template.md)
- [`references/base-vs-custom.md`](references/base-vs-custom.md)
- [`../create-tool/references/client-facing-copy.md`](../create-tool/references/client-facing-copy.md)
- [`../create-tool/references/graph-by-mutation.md`](../create-tool/references/graph-by-mutation.md)
- [`../create-tool/references/layers.md`](../create-tool/references/layers.md)
- [`../create-tool/references/post-ship-ops.md`](../create-tool/references/post-ship-ops.md)
