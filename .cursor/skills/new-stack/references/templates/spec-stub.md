# Feature spec: <Stack / profile title>

- Slug: `<slug>`
- Status: Draft | Approved for implementation
- Primary type: `stack_profile`
- Secondary types: `integration` | `dashboard` | `security_trust` | …
- Date:
- Owner:

## Problem

…

## Actor and outcome

- Actor: `platform_owner` (dashboard); client uses Telegram after pairing.
- Success criteria:
  - …
- Freeze (must not change):
  - Existing live stacks/tools (name them)
  - Global admin Telegram topology
  - ADR-0042 fail-closed shared port scopes

## Identity

- Stack id (hyphen):
- Project profile (underscore):
- Selectable enrollment: yes / reserved only

## Behavior

### In scope

- Enrollment wizard / profile select
- Required credentials and activation checks
- Empty capability catalog policy (allowed or not)
- Manifest / global profile stubs sufficient for validation

### Out of scope

- First content capabilities (later create-tool) unless explicitly in-scope
- Changes to frozen stacks
- …

### Failure modes

- …

### Acceptance criteria

1. Operator can create enrollment with this profile.
2. Required credentials verify without forbidden mutations.
3. Pairing activates enrollment per ONBOARDING / ENROLLMENT.md.
4. Empty-catalog / tool-assignment rules hold.
5. Frozen stacks still pass regression.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 2 rule change | Approve / alternative / abort / n/a | |

## Documentation impact assessment

Required by [`AGENTS.md`](../../../../AGENTS.md):

- Canonical documents changed:
- ADRs added, superseded, or confirmed unchanged:
- Public contracts, schemas, states, permissions, operational steps, and tests affected:
- Migration or rollback documentation affected:

## Compatibility

- Tools / executorIds / ports affected (usually none until first tool):
- ADR-0042 notes:

## Open questions

- …

## Handoff

- Readiness handoff completed: yes / no
- Implementation is a **separate** session; this skill does not implement.
- First capability → create-tool after enrollment works.
- Operator runbook: [`docs/ENROLLMENT.md`](../../../../docs/ENROLLMENT.md) section B
