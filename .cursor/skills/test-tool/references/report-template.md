# Audit report template (Phase 5)

Save to: `docs/audits/<toolId>[-<clientKey>]-<YYYY-MM-DD>.md`

```markdown
# Audit: {toolId} ({auditMode}{optional: / clientKey}) — {date}

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | |
| auditMode | base \| customized |
| clientKey | |
| locale | |
| depth | smoke \| standard \| deep |
| environment | offline \| local-live |

## Summary

- **Pass:** N / **Total:** M
- **Blockers:** (count + one-line each)
- **Major:** (count)
- **Top actions:** (max 5 bullets)

## Tool profile

(Copy from Phase 1 discovery table)

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass/fail | |
| @binflow/workflows test | pass/fail | |
| @binflow/policies test | pass/fail | |
| capability-conformance.test.ts | pass/fail | |
| (executor package) | pass/fail | |

## Findings

| ID | Severity | Scenario | Observation | Layer | Fix |
|----|----------|----------|-------------|-------|-----|
| F-01 | blocker/major/minor/info | DEL-03 | … | code/manifest/customization | file or doc path |

### F-01 — {title}

- **Scenario:** {ID}
- **Severity:** …
- **Layer:** …
- **Observation:** …
- **Suggested fix:** …
- **Status:** open \| fixed \| wontfix

## Scenario results

| Scenario | Auto | Live | Result | Notes |
|----------|------|------|--------|-------|
| COM-01 | pass | pass/skip/unverified | pass/fail | |

## Test gaps

Scenarios without automated or live coverage:

- {ID}: …

## Suggested preventive actions

1. Add ingress test for …
2. Update `docs/specs/…` § Verification …
3. Add create-tool antipattern …

## Follow-ups

- [ ] Code PR
- [ ] Doc / ADR update
- [ ] TESTING.md row
- [ ] Re-run audit after fix
```

## Chat summary (always print)

Keep under 15 lines:

1. Pass rate
2. Blockers (if any) with scenario IDs
3. Top 3–5 actionable fixes with layer
4. Path to full report file
5. Offer re-audit after fixes (do not auto-fix unless asked)
