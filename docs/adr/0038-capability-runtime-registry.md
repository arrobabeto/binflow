# ADR-0038: Capability runtime registry and catalog-backed graph versions

- Status: Accepted
- Date: 2026-08-28
- Supersedes: None
- Superseded by: None

## Context

Adding a Binflow capability required editing hardcoded `if` branches in the worker
(`isProject`), a stale `graphVersionForCapability` helper in workflows (returning
`create-project@3` while `tool.yaml` was already `@4`), twelve literal
`getTool('<capabilityId>')` calls in AI generation ports, and fixed capability ids
inside workflow runtimes for customization loading.

Unknown capabilities fail open into the blog runtime. Graph version drift is silent.
There is no cross-layer test that a catalog tool is registered in policies,
contracts, migrations, and the worker registry.

## Decision

1. **Graph version from the declarative catalog.** Workflows resolve
   `graphVersion` via `getTool(capabilityId)` → `tool.graphVersion`. Legacy
   `create_project_draft` aliases to `create_project_astro` for catalog lookup.
2. **Worker runtime registry keyed by `executorId`.** `packages/workflows/src/capability-runtimes.ts`
   maps `workflow.create_blog@1` and `workflow.create_project@1` to runtime kind,
   notification title field, and processed-event consumer prefix. Unknown
   `executorId` throws `DomainError` (fail-closed).
3. **Parameterized AI ports and runtimes.** OpenAI generation ports accept
   `capabilityId` and load node config from the catalog dynamically. Workflow
   runtimes pass `context.request.capabilityId` to `loadCustomizationSection`.
4. **Data-driven Telegram command table.** `capabilityIngressRoutes` in workflows
   derives slash commands from `capabilityRegistry` with explicit handler kind and
   optional natural-language matchers.
5. **Conformance tests.** `packages/workflows/test/capability-conformance.test.ts`
   asserts catalog ↔ policies ↔ contracts ↔ migrations ↔ worker registry alignment
   for every loaded tool.

## Consequences

- New capabilities still require a registry entry in `capability-runtimes.ts` until
  a generic executor exists, but graph version and AI node config no longer need
  per-id edits.
- Fail-closed worker dispatch surfaces misconfiguration at job time instead of
  running the wrong executor.
- Conformance tests catch forgotten migrations or contract enum entries before
  Telegram ingress.

## Alternatives considered

- **Duplicate `graphVersion` in policies registry** — rejected; duplicates
  `tool.yaml` and drifts.
- **Fully generic runtime without executor families** — deferred; blog and project
  executors share structure but differ in validation and artifacts.

## Verification

- `packages/workflows/test/capability-conformance.test.ts`
- `packages/workflows/test/workflow.test.ts` (graph version regression)
- Worker resolves known `executorId`; unknown id throws
- Docs: `docs/CONTRACTS.md`, `docs/WORKFLOWS.md`, `docs/CHANGELOG.md`
