# Eleven-layer checklist

Mark each layer before marking the tool done.

| # | Layer | Path | Required |
|---|-------|------|----------|
| 1 | Brief | `packages/tools/briefs/<id>.brief.yaml` | Always |
| 2 | ADR | `docs/adr/00NN-*.md` | When trust boundary or durable decision |
| 3 | Spec | `docs/specs/<name>.md` | Always |
| 4 | Catalog | `packages/tools/stacks/<stack>/<tool>/` | Always |
| 5 | Contracts | `packages/contracts/src/index.ts` | Always |
| 6 | Policies | `packages/policies/src/index.ts` | Always |
| 7 | Migration | `packages/db/migrations/00NN_*_capability.sql` | Always — then `pnpm db:migrate` before assignment |
| 8 | Runtime registry | `packages/workflows/src/capability-runtimes.ts` | Always |
| 9 | Executor + runtime | `packages/*` + `packages/workflows/src/*-runtime.ts` | Always |
| 10 | Ingress | `packages/workflows/src/capability-ingress.ts` + handlers | When Telegram-exposed |
| 11 | Conformance | `packages/workflows/test/capability-conformance.test.ts` | Always (extend scenarios) |
| 12 | Stack gate | Brief `allowedProfiles` = `tool.yaml` profile; assignment only when `projects.profile` ∈ allowed | Always |

## Conditional

| Layer | When |
|-------|------|
| Pilot customization | `docs/customizations/<client>-<tool>.md` + upload script |
| Manifest paths | New content areas in `packages/manifests` + rematerialize script |
| `request_state` enum | Novel workflow states only |
| OPERATIONS | Migration rollback, operator scripts |
| SECURITY | New trust boundary (URL fetch, destructive ops) |
| TELEGRAM | Command, NL routing, collection behavior |
| TESTING | Scenario matrix rows |

## Extended (lessons delete_blog)

| # | Layer | Reference |
|---|-------|-----------|
| 13 | Client copy | `references/client-facing-copy.md` — plan, admin, no repo paths |
| 14 | Post-ship ops | `references/post-ship-ops.md` — migrate, binding, rematerialize, capability vN; no hardcoded `@1` on graph resolve / request_versions |
| 15 | Graph coherence | `references/graph-by-mutation.md` — read nodes aloud; no create names on delete |
| 16 | Ingress tests | `packages/workflows/test/*-ingress.test.ts` — NL conjugations, dispatch priority |
| 17 | Inline CTAs | `references/client-facing-copy.md` — surface → action → label per locale; no create CTAs on destructive |
| 18 | Shared code impact | Before changing a shared port: list `executorId`s / runtime kinds that call it; require opt-in scope (ADR-0042). For `catalog_sync`, set `parameters.catalogScope` and register in `catalogScopeForRuntimeKind`. |

## Verification commands

```bash
pnpm db:migrate
pnpm --filter @binflow/tools build
pnpm --filter @binflow/tools test
pnpm --filter @binflow/workflows test
pnpm --filter @binflow/policies test
pnpm --filter @binflow/contracts test
```

After migrate, confirm the capability row exists before toggling assignment in
the dashboard (`capability_definitions.id` + `allowed_profiles`).

Scaffold dry-run (includes graph coherence warnings):

```bash
pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/<id>.brief.yaml --dry-run
```

## Graph coherence gate

Before ship, every `node.id` must match its label semantics per mutation class.
Destructive tools must not list `create_draft` or `wait_preview`.

## Retrospective validation

- `delete_blog_draft.brief.yaml` — reference pass after skill update.
- `delete_project_astro.brief.yaml` — expected fail until graph rewritten.
