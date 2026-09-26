# Agent skills (repository)

Canonical inventory of Cursor agent skills shipped under
[`.cursor/skills/`](../../.cursor/skills/). Skills encode **how** agents prepare
or change Binflow work; canonical product behavior still lives in `docs/` and
accepted ADRs ([`AGENTS.md`](../../AGENTS.md)).

Triggers are approximate (`/new-feature`, natural language). Always open the
linked `SKILL.md` before running a skill.

## Quick map

| Skill | Implements product code? | Primary use |
|-------|--------------------------|-------------|
| [new-feature](#new-feature) | No | Governance gate for platform/product features |
| [new-stack](#new-stack) | No | Prepare a new project profile / catalog stack |
| [create-tool](#create-tool) | Yes | Author one new capability on an existing stack |
| [test-tool](#test-tool) | Audit only (fixes only if asked) | Post-ship client-realistic tool audit |
| [edit-node-config](#edit-node-config) | Narrow yes | Change agent node model / effort / rules |

## Typical order

```text
new-feature  (if rules / SCOPE / ADR / trust boundary may change)
    └─ new-stack  (if new profile / catalog stack)
         └─ impl session (enrollment)
              └─ create-tool  (first capability)
                   └─ test-tool  (post-ship audit)

edit-node-config  (existing tool node defaults only)
```

Site builds that only label surfaces use **BSI docs**, not these skills:
[Binflow Surface Inventory](binflow-surface-inventory.md) +
[briefs/bsi/](../briefs/bsi/README.md).

---

## new-feature

| | |
|--|--|
| Path | [`.cursor/skills/new-feature/SKILL.md`](../../.cursor/skills/new-feature/SKILL.md) |
| Implements code? | **No** — docs / ADRs / handoff only |

**Description.** Documentation-first governance gate for platform or product
features (integrations, dashboard, workflow kernel, security, ops). Classifies
the ask, maps impact on canonical docs/ADRs/tools/ports, STOPs for explicit
approval when rules change, writes specs/ADRs/changelog, then hands off.

**Scope.**

- In: non-trivial features before implementation; `/new-feature`; trust-boundary
  or ADR-conflict work.
- Out: product executors, migrations, scaffolds; pure typo/docs cleanup; “one
  capability on an existing stack with no rule change” → prefer create-tool;
  new stack/profile → prefer **new-stack**.

**Use when.** Platform change that may touch SCOPE, MVP, SECURITY, or accepted
ADRs, or when create-tool would be too narrow.

---

## new-stack

| | |
|--|--|
| Path | [`.cursor/skills/new-stack/SKILL.md`](../../.cursor/skills/new-stack/SKILL.md) |
| Implements code? | **No** — preparation + readiness handoff only |

**Description.** Preparation gate for a new project `profile` + catalog
`stack` (enrollment before tools). Interview → impact → approval STOP →
spec/ADR/docs/CHANGELOG → readiness handoff for a later implementation
session. Also requires a **BSI stack brief**
(`docs/briefs/bsi/<stack>.md`) and a **stack tool contract** under
`.cursor/skills/create-tool/references/stacks/`.

**Scope.**

- In: `/new-stack`, “nuevo stack”, habilitar profile, enrollment-only prep.
- Out: implementing enrollment/runtime code; first capability (create-tool);
  non-stack platform features (new-feature).

**Use when.** Adding `astro_*`, `shopify_*`, or any future profile before tools
exist. After Phase 5, stop — implementation is a separate Agent request.

---

## create-tool

| | |
|--|--|
| Path | [`.cursor/skills/create-tool/SKILL.md`](../../.cursor/skills/create-tool/SKILL.md) |
| Implements code? | **Yes** — brief → scaffold → implement → post-ship |

**Description.** Human-in-the-loop pipeline to create one Binflow capability on
an existing (documented/enrollable) stack: interview, brief YAML, scaffold under
`packages/tools/stacks/`, implement executors/workflows, post-ship ops,
conformance.

**Scope.**

- In: new capability on a live profile; requires stack tool contract file.
- Out: new stack/profile without new-stack prep; widening shared ports
  (ADR-0042); silent ADR/SCOPE changes (run new-feature/new-stack first).

**Use when.** “Add tool X on `astro_orbitype` / `shopify_liquid` / …” after
governance and stack contract exist. Load
[`.cursor/skills/create-tool/references/stacks/`](../../.cursor/skills/create-tool/references/stacks/README.md)
before Phase 0.

---

## test-tool

| | |
|--|--|
| Path | [`.cursor/skills/test-tool/SKILL.md`](../../.cursor/skills/test-tool/SKILL.md) |
| Implements code? | **No by default** — audit report; fixes only if the user asks |

**Description.** Post-ship audit from the **client** perspective: Telegram copy,
CTAs, states, graph semantics, customization — not only unit/conformance tests.
Writes under `docs/audits/` when applicable.

**Scope.**

- In: after create-tool ships; after UX/copy changes; customized-client audits.
- Out: inventing new tools; auto-editing product code without an explicit ask.

**Use when.** Validating a capability is client-safe. Parameters include
`toolId`, `stack`, `auditMode`, `locale`, `depth`, `environment` (see skill).

---

## edit-node-config

| | |
|--|--|
| Path | [`.cursor/skills/edit-node-config/SKILL.md`](../../.cursor/skills/edit-node-config/SKILL.md) |
| Implements code? | **Narrow** — declarative `node.yaml` / `rules.md` only |

**Description.** Change base model, effort, or rules for an existing **agent**
node in the repository catalog (`packages/tools/stacks/.../nodes/`).

**Scope.**

- In: allowlisted model/effort; optional `rules.md` / `rulesRef` (warn on shared
  rules).
- Out: executors, permissions, graph topology, new capabilities (unless a
  separate ADR requires it).

**Use when.** Tuning LLM node defaults without a full create-tool run. Run
`pnpm --filter @binflow/tools test` and update CHANGELOG / INTEGRATIONS when
defaults change.

---

## Related

- [DEVELOPMENT.md](../DEVELOPMENT.md) — coding standards; short skills pointer
- [DOCUMENTATION-GOVERNANCE.md](../DOCUMENTATION-GOVERNANCE.md)
- [ADR-0039](../adr/0039-tool-authoring-pipeline.md) — create-tool / test-tool pipeline
- [docs/audits/](../audits/README.md) — test-tool outputs
- [BSI](binflow-surface-inventory.md) — site labeling (not a skill)
