---
name: new-stack
description: >-
  Preparation-only gate for adding a Binflow project profile / stack (enrollment
  before tools). Interviews scope, measures impact vs docs/ADRs/tools, STOP for
  rule changes, writes spec/ADR/canonical docs/changelog, and emits a readiness
  handoff for a later implementation session. Does not implement product code.
  Use for /new-stack, "nuevo stack", "habilitar profile", or stack_profile work
  after or instead of generic new-feature.
---

# New Stack (preparation gate)

Binflow is documentation-first ([`AGENTS.md`](../../../AGENTS.md)). This skill
**prepares** a new project `profile` + catalog `stack` so a later Agent session
can implement enrollment safely. It measures scope and implications and leaves
docs + a readiness package. It does **not** implement.

Worked reference: [`docs/specs/astro-orbitype-enrollment.md`](../../../docs/specs/astro-orbitype-enrollment.md),
[ADR-0045](../../../docs/adr/0045-astro-orbitype-enrollment.md).

## Hard rules

1. **Never** implement product code: no `packages/*` executors, no dashboard
   wiring, no migrations, no worker changes, no `packages/tools/stacks/`
   scaffolds from this skill.
2. Read [`docs/README.md`](../../../docs/README.md) ownership map before impact.
3. Never silently supersede an accepted ADR; `rule_change` requires Phase 3 STOP
   and explicit user approval.
4. Do not edit the user’s attached plan file (if any).
5. Shared ports / multi-tool impact → ADR-0042 (no wider factory defaults).
6. Freeze existing live stacks unless a superseding ADR is approved.
7. After Phase 5, **stop**. Implementation is a separate request.

## When to use

- `/new-stack`, “nuevo stack”, “habilitar profile”, new `projectProfile`.
- Enrollment for a stack before any capabilities exist.
- `new-feature` classified the ask as `stack_profile`.

## When NOT to use

- Implementing the stack (use the readiness handoff in a normal Agent session).
- One capability on an **existing** profile → [`create-tool`](../create-tool/SKILL.md).
- Non-stack platform features → [`new-feature`](../new-feature/SKILL.md).
- Operator enrollment of a client → [`docs/ENROLLMENT.md`](../../../docs/ENROLLMENT.md).

## Naming

| Concept | Form | Example |
|---------|------|---------|
| Stack (catalog dir) | hyphenated | `astro-orbitype` |
| Project profile | underscored | `astro_orbitype` |
| Capability | id@version | `create_blog_draft@1` |

## Phase overview

```text
0 Interview → 1 Impact → 2 Approval STOP (if needed)
  → 3 Docs package (spec/ADR/canonical/CHANGELOG)
  → 4 Readiness handoff → 5 Stop (no implementation)
```

---

## Phase 0 — Interview

Run [`references/interview.md`](references/interview.md) phase by phase. After
each phase, summarize and wait for user confirmation before continuing.

Fill [`references/templates/stack-brief.md`](references/templates/stack-brief.md).

---

## Phase 1 — Impact

1. Follow [`references/impact-matrix.md`](references/impact-matrix.md).
2. Reuse status vocabulary from
   [`../new-feature/references/templates/impact-report.md`](../new-feature/references/templates/impact-report.md)
   (`compatible` | `docs_gap` | `rule_change` | `tool_risk`).
3. Present the Impact Report. Do not write ADRs or implement yet.

If any row is `rule_change`, or a new/superseding ADR is required → Phase 2.
Otherwise → Phase 3.

---

## Phase 2 — Approval gate (STOP)

Follow
[`../new-feature/references/approval-gate.md`](../new-feature/references/approval-gate.md).

Do not edit SCOPE, SECURITY, MVP, or accepted ADRs until the user explicitly
approves. On abort, stop the skill.

---

## Phase 3 — Documentation package

Still **no product code**.

1. Write `docs/specs/<slug>.md` from
   [`references/templates/spec-stub.md`](references/templates/spec-stub.md)
   (include AGENTS.md documentation-impact block).
2. Update affected canonical docs using
   [`../new-feature/references/doc-checklist.md`](../new-feature/references/doc-checklist.md)
   plus stack extras in [`references/impact-matrix.md`](references/impact-matrix.md).
   Always consider `ONBOARDING.md`, `ENROLLMENT.md` (section B notes),
   `DASHBOARD.md`, `INTEGRATIONS.md`, `CONTRACTS.md`, `GLOSSARY.md`.
3. Add or amend ADR under `docs/adr/`; index `docs/adr/README.md` and
   `docs/DECISIONS.md` when used.
4. Add `docs/CHANGELOG.md` Unreleased entry.
5. Confirm relative Markdown links.

Mark the spec **Approved for implementation** only after Phase 2 (or when no
Phase 2 was needed).

---

## Phase 4 — Readiness handoff

Fill
[`references/templates/readiness-handoff.md`](references/templates/readiness-handoff.md)
using [`references/readiness-checklist.md`](references/readiness-checklist.md).

Include:

- Ordered implementation tasks (contracts → packages → dashboard → tests).
- Explicit freezes (existing stacks, ADR-0042).
- Empty-catalog policy.
- Smoke criteria from [`references/enrollment-smoke.md`](references/enrollment-smoke.md)
  / [`docs/ENROLLMENT.md`](../../../docs/ENROLLMENT.md) section B.
- **Stack tool contract** written to
  [`.cursor/skills/create-tool/references/stacks/<stack>.md`](../create-tool/references/stacks/README.md)
  from [`references/templates/stack-tool-contract.md`](references/templates/stack-tool-contract.md),
  and indexed in that README. Without this file, create-tool/test-tool must refuse
  the first capability on the stack.
- Next steps: “implementation session”, then later
  [`create-tool`](../create-tool/SKILL.md) for the first capability (after the
  contract file exists).

Present the handoff to the user. Do **not** start coding.

---

## Phase 5 — Stop

Tell the user explicitly:

1. Preparation is complete (spec, ADR, docs, readiness handoff, **stack tool
   contract** under `create-tool/references/stacks/`).
2. Implementation is a **separate** Agent request using the handoff.
3. First content tool is a further separate [`create-tool`](../create-tool/SKILL.md)
   run after the profile is enrollable — create-tool loads the stack contract
   first (blocked if missing).
4. Operator enrollment uses [`docs/ENROLLMENT.md`](../../../docs/ENROLLMENT.md).

---

## References

- [`references/interview.md`](references/interview.md)
- [`references/impact-matrix.md`](references/impact-matrix.md)
- [`references/readiness-checklist.md`](references/readiness-checklist.md)
- [`references/enrollment-smoke.md`](references/enrollment-smoke.md)
- [`references/templates/stack-brief.md`](references/templates/stack-brief.md)
- [`references/templates/spec-stub.md`](references/templates/spec-stub.md)
- [`references/templates/readiness-handoff.md`](references/templates/readiness-handoff.md)
- [`references/templates/stack-tool-contract.md`](references/templates/stack-tool-contract.md)
- Sibling: [`../new-feature/SKILL.md`](../new-feature/SKILL.md)
- Sibling: [`../create-tool/SKILL.md`](../create-tool/SKILL.md)
- Sibling: [`../test-tool/SKILL.md`](../test-tool/SKILL.md)
