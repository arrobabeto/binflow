# Readiness handoff: <stack / profile>

- Spec: `docs/specs/<slug>.md`
- ADR:
- Date:
- Prepared by: new-stack skill
- Status: Ready for implementation | Blocked (why)

## Summary

One paragraph: what will be enrollable after impl, what stays frozen.

## Explicit freezes

- …

## Empty catalog

- Allowed at `ACTIVE`: yes / no
- Notes:

## Ordered implementation tasks

Use [`../readiness-checklist.md`](../readiness-checklist.md). Copy applicable
items in dependency order, for example:

1. Contracts + tests
2. Manifests / onboarding checks
3. Provider verifier package (if any) + integration-admin / CLI
4. Dashboard enrollment + integrations UI
5. Regression tests for frozen stacks
6. Smoke per [`../enrollment-smoke.md`](../enrollment-smoke.md)

Do **not** start these tasks inside new-stack.

## Tests minimum

- …

## Ops notes

- Single Telegram polling worker
- Client bot hot-load on heartbeat
- ENROLLMENT.md section B after ship

## Next requests (for the user)

1. **Implementation session** — Agent mode with this handoff + approved spec/ADR.
2. **Stack tool contract** — confirm
   `.cursor/skills/create-tool/references/stacks/<stack>.md` exists (from
   [`stack-tool-contract.md`](../templates/stack-tool-contract.md)) before any
   create-tool run.
3. **BSI stack brief** — confirm `docs/briefs/bsi/<stack>.md` exists (from
   [`bsi-stack-brief.md`](../templates/bsi-stack-brief.md)) and is indexed in
   `docs/briefs/bsi/README.md`.
4. **First capability** — [`create-tool`](../../../create-tool/SKILL.md) after
   enrollment works (creates `packages/tools/stacks/<stack>/…`); loads the
   stack contract in Phase 0.
5. **test-tool** — after ship, with the same stack contract + stack overlays.
6. **Operator enrollment** — [`docs/ENROLLMENT.md`](../../../../../docs/ENROLLMENT.md).

## Stack tool contract path

- File: `.cursor/skills/create-tool/references/stacks/<stack>.md`
- Index: `.cursor/skills/create-tool/references/stacks/README.md`
- Status: written | missing (blocker for create-tool)

## BSI stack brief path

- File: `docs/briefs/bsi/<stack>.md`
- Index: `docs/briefs/bsi/README.md`
- Platform guide: `docs/guides/binflow-surface-inventory.md`
- Status: written | missing (blocker for readiness completion)

## Out of scope for the impl session

- …
