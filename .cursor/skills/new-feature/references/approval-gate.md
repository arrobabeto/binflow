# Approval gate (Phase 3)

## When STOP is mandatory

Enter this phase if the Impact Report has **any** of:

- Status `rule_change` on any row
- Need to **create** a new ADR that reverses or narrows an accepted decision
- Need to **supersede** an accepted ADR
- SCOPE / PRODUCT / MVP / ROADMAP expansion or reduction
- SECURITY trust-boundary change (auth, webhooks, secrets, tenancy, destructive
  remote ops)

`docs_gap` alone does **not** require this STOP (proceed to Phase 4 docs), but
if filling the gap effectively changes a durable decision, treat it as
`rule_change`.

`tool_risk` alone does not require STOP if mitigation is ADR-0042-compatible
(explicit scope, no wider defaults). If mitigation needs a rule change, STOP.

## What to present (fixed structure)

```markdown
### Approval required — rule / decision change

**Feature:** <slug or title>
**Primary type:** <type>

#### Conflicts or expansions
| Item | Current rule (cite) | Proposed change | Risk if wrong |
|------|---------------------|-----------------|---------------|

#### Proposed ADR
- Title:
- Status after approval: Proposed → Accepted (only after user OK)
- Supersedes: <none | ADR-NNNN>

#### Alternative that avoids rule change
<one paragraph, or “none without dropping the feature”>

#### Ask
Reply with one of:
1. **Approve** — proceed to Phase 4 docs/ADR as proposed
2. **Approve with edits** — <user edits>
3. **Use alternative** — no rule change; re-scope feature
4. **Abort**
```

## While waiting

- Do **not** edit accepted ADRs, SCOPE, SECURITY, MVP, or product code.
- Do **not** start create-tool or implementation.
- You may refine the Impact Report text only.

## After user reply

| Reply | Action |
|-------|--------|
| Approve | Phase 4 with proposed ADR/docs |
| Approve with edits | Incorporate edits, then Phase 4 |
| Use alternative | Re-run Phase 2 statuses; skip ADR supersede; Phase 4 for reduced scope |
| Abort | Stop skill; leave repo unchanged by this skill |

Record the approval choice in the feature brief (Phase 4) under
“Governance approvals”.
