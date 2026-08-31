# Implementation readiness checklist

This skill **does not execute** these items. List them in the readiness handoff
for a later implementation session.

## Contracts and tests

- [ ] Add profile to `projectProfileSchema` (and reserved vs selectable)
- [ ] Add to `selectableEnrollmentProfileSchema` if enrollable now
- [ ] New credential / integration kinds + candidate schemas if needed
- [ ] Update `docs/CONTRACTS.md`
- [ ] Contract tests for new enums / enrollment payloads

## Manifests and onboarding

- [ ] Global profile stub in `packages/manifests`
- [ ] `credentialChecksForProfile` / activation check list
- [ ] Empty capability catalog gate (`emptyAllowed` or required bindings)
- [ ] Onboarding / enrollment validation tests

## Provider package (if new)

- [ ] New package (e.g. `@binflow/<provider>`) with **read-only** verifier
- [ ] Wire into `packages/integration-admin` and CLI integration input
- [ ] Unit tests for verifier (no live secrets in fixtures)

## Dashboard / control plane

- [ ] Profile select on `clients/new`
- [ ] Enrollment detail: tools filtered by profile; empty-tools UX if allowed
- [ ] Integrations UI for new credential kind
- [ ] Locale rules per profile (Webbin overlay vs selectable)

## Runtime

- [ ] Enrollment-only: usually **no** worker capability wiring
- [ ] Confirm Telegram client bot hot-load on heartbeat still covers new bots
- [ ] Do not start tools/executors until create-tool

## Tool catalog

- [ ] **Defer** `packages/tools/stacks/<stack>/` until first create-tool
- [ ] Document intended stack path in spec/ADR only
- [ ] **new-stack (this skill):** write
      `.cursor/skills/create-tool/references/stacks/<stack>.md` from
      `templates/stack-tool-contract.md` and index it — **before** create-tool
- [ ] Link or create `docs/guides/<stack>-tool-implementation.md` when the first
      tool ships (Orbitype reference:
      `docs/guides/astro-orbitype-tool-implementation.md`)

## Regression

- [ ] Existing profile enrollments and tools unchanged
- [ ] No shared port default widening (ADR-0042)
- [ ] No hardcoded Webbin origins/paths in shared messaging for the new stack
      (ADR-0048)

## Docs already done by new-stack

- [ ] Spec, ADR, canonical docs, CHANGELOG (Phase 3) — verify still accurate after impl
- [ ] Stack tool contract file + stacks README index row
- [ ] Point operators to `docs/ENROLLMENT.md` section B
- [ ] Readiness handoff lists contract path and create-tool/test-tool next steps