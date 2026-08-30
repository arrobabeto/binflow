---
name: new-feature
description: >-
  Documentation-first governance gate for Binflow platform or product features
  (new stack/profile, integration, dashboard, workflow kernel, security, ops).
  Classifies the feature, maps impact on canonical docs/ADRs/tools/ports, STOP
  for explicit approval when rules change, writes specs/ADRs/changelog, then
  hands off to create-tool or an implementation plan. Use for /new-feature,
  "nueva feature", "habilitar stack", or any non-trivial feature before code.
  Does not implement executors, migrations, or scaffold tools.
---

# New Feature (governance gate)

Binflow is documentation-first ([`AGENTS.md`](../../../AGENTS.md),
[`docs/DOCUMENTATION-GOVERNANCE.md`](../../../docs/DOCUMENTATION-GOVERNANCE.md)).
This skill is the **intake gate** for platform/product features. It recognizes
the feature, enforces repo rules, flags ADR/SCOPE/SECURITY conflicts for human
approval, writes or updates canonical documentation, then hands off. It does
**not** implement product code.

## When to use

- User asks `/new-feature`, “nueva feature”, “habilitar un stack”, new profile,
  new integration, dashboard surface, ops/deploy change, or trust-boundary work.
- Before [`create-tool`](../create-tool/SKILL.md) when the ask is broader than
  “one new capability” (e.g. new stack, then tools).
- When an implementation request would silently contradict an accepted ADR.

## When NOT to use

- Pure typo / docs-only cleanup with no behavior change → edit docs directly.
- “Create capability X on an existing stack” with no rule changes → prefer
  [`create-tool`](../create-tool/SKILL.md) (still run a short Phase 2 impact if
  unsure).
- Post-ship client-realistic audit → [`test-tool`](../test-tool/SKILL.md).

## Hard rules

1. Read [`docs/README.md`](../../../docs/README.md) ownership map before classifying.
2. **Never** implement executors, worker wiring, DB migrations, or scaffolds in
   this skill.
3. **Never** silently supersede or rewrite an accepted ADR. `rule_change` or a
   new ADR requires Phase 3 STOP and explicit user approval.
4. Do **not** edit the user’s attached plan file (if any).
5. Shared ports / multi-tool impact → apply ADR-0042 (see impact matrix).
6. After Phase 4, leave a clear handoff (create-tool vs implementation plan).

## Phase overview

```text
0 Interview → 1 Classify → 2 Impact report → 3 Approval STOP (if needed)
  → 4 Docs + ADR + CHANGELOG → 5 Handoff
```

---

## Phase 0 — Recognition (interview)

Run [`references/interview.md`](references/interview.md) phase by phase. After
each phase, summarize and wait for user confirmation before continuing.

Capture at minimum: problem, actor, outcome, mutates durable state?, LLM?,
GitHub/Vercel/Telegram?, new profile/stack?, new capability?, outside
SCOPE/MVP?

---

## Phase 1 — Classification

Assign one **primary** type (and optional secondary):

| Type | Meaning | Typical handoff |
|------|---------|-----------------|
| `capability` | New Telegram/API tool on an existing profile | → create-tool |
| `stack_profile` | New stack directory and/or project `profile` | → impl plan, then create-tool for first tools |
| `integration` | New or changed external provider behavior | → impl plan |
| `dashboard` | Admin UI / control-plane surface | → impl plan |
| `workflow_kernel` | Request states, outbox, approvals kernel | → ADR + impl plan |
| `security_trust` | Auth, tenancy, secrets, trust boundaries | → SECURITY + ADR |
| `ops_deploy` | Runtime, deploy, recovery, Compose | → OPERATIONS + ADR |
| `docs_only` | Document existing behavior / governance | → docs only |

State the primary type to the user and confirm before Phase 2.

---

## Phase 2 — Impact and compatibility

1. Follow [`references/impact-matrix.md`](references/impact-matrix.md).
2. Fill [`references/templates/impact-report.md`](references/templates/impact-report.md).
3. For each concern mark exactly one status:
   - `compatible` — already documented; implementation may proceed after docs touch-ups
   - `docs_gap` — new behavior; prose/spec/ADR missing
   - `rule_change` — contradicts accepted ADR, SCOPE, SECURITY, or MVP boundary
   - `tool_risk` — shared ports, runtimes, or other tools may regress (ADR-0042)

Present the Impact Report. Do not write ADRs or implement yet.

If any row is `rule_change`, or a new ADR is required → Phase 3.
If only `compatible` / `docs_gap` / `tool_risk` with documented mitigation →
Phase 4 (still list tools/ports for tool_risk).

---

## Phase 3 — Approval gate (STOP)

Follow [`references/approval-gate.md`](references/approval-gate.md).

Present:

- Which rule would change (cite ADR/doc).
- Proposed ADR title / supersede link.
- Risks and a **no-rule-change** alternative if one exists.
- Ask: approve rule change, choose alternative, or abort.

**Do not** edit accepted ADRs, SCOPE, SECURITY, or MVP until the user explicitly
approves. On abort, stop the skill.

---

## Phase 4 — Documentation

Use [`references/doc-checklist.md`](references/doc-checklist.md).

After approval (or when no Phase 3 was needed):

1. Write `docs/specs/<slug>.md` from
   [`references/templates/feature-brief.md`](references/templates/feature-brief.md)
   (include AGENTS.md documentation-impact block).
2. Update affected canonical docs from the checklist.
3. Add or amend ADR under `docs/adr/` if Phase 3 approved; index in
   `docs/adr/README.md`.
4. Add `docs/CHANGELOG.md` Unreleased entry.
5. Confirm relative Markdown links.

Still **no product code**.

---

## Phase 5 — Handoff

| Primary type | Next step |
|--------------|-----------|
| `capability` | Invoke [`create-tool`](../create-tool/SKILL.md) with specs/ADR aligned |
| `stack_profile` | Implementation plan only: stack path, profile enum, enrollment, `allowedProfiles`, first tool via create-tool later |
| `integration` / `dashboard` / `workflow_kernel` / `security_trust` / `ops_deploy` | Ordered documentation-first task list for Agent mode |
| `docs_only` | Done after Phase 4 |

Tell the user explicitly: governance complete; implementation is a **separate**
request (Agent mode / create-tool).

---

## Worked example: enable a new stack

See [`references/impact-matrix.md`](references/impact-matrix.md) § Stack profile
walkthrough (ADR-0030, SCOPE, ONBOARDING, `allowedProfiles`, ADR-0042).

Expected outcome: Impact Report + approval if MVP/SCOPE expands +
`docs/specs/<stack>-profile.md` + ADR + CHANGELOG + handoff plan — **no**
`packages/tools/stacks/` code from this skill.

## References

- [`references/interview.md`](references/interview.md)
- [`references/impact-matrix.md`](references/impact-matrix.md)
- [`references/approval-gate.md`](references/approval-gate.md)
- [`references/doc-checklist.md`](references/doc-checklist.md)
- [`references/templates/feature-brief.md`](references/templates/feature-brief.md)
- [`references/templates/impact-report.md`](references/templates/impact-report.md)
