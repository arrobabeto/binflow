# ADR-0039: Tool authoring pipeline (brief, scaffolder, conformance)

- Status: Accepted
- Date: 2026-08-28
- Supersedes: None
- Superseded by: None

## Context

Adding a Binflow tool touched eleven layers (catalog YAML, contracts, policies,
migration, executor, runtime, worker registry, AI port, ingress, docs, tests)
with no single interview artifact and no automated cross-layer validation. Agents
and operators iterated through Telegram trials to discover missing wiring.

## Decision

1. **Human-in-the-loop brief.** `packages/tools/briefs/<id>.brief.yaml` captures
   identity, mutation class, graph nodes/edges, content_schema fields, layer
   assignments, typed errors, and verification scenarios. Parsed by
   `packages/tools/src/tool-brief.ts` (Zod).
2. **Scaffolder.** `packages/tools/scripts/scaffold-tool.ts` generates catalog
   files, migration SQL, spec, and ADR draft from a validated brief; prints
   manual TS snippets for policies/contracts/registry. Supports `--dry-run`.
3. **Authoring skill.** `.cursor/skills/create-tool/` runs a phased interview,
   writes the brief, invokes the scaffolder, then guides executor/runtime
   implementation, post-ship ops, and conformance tests. Reference docs cover:
   - `references/graph-by-mutation.md` — node naming by mutation class
   - `references/client-facing-copy.md` — Telegram / admin copy (no repo paths); inline CTA matrix per tool and decision surface
   - `references/post-ship-ops.md` — migrate before assign, default bindings, rematerialize, append-only capability versions
   - Extended checklist layers: client copy, inline CTAs, post-ship ops, graph coherence, ingress tests
4. **Scaffolder guards.** `scaffold-tool.ts` rejects destructive briefs that
   reuse `create_draft` / `wait_preview`; prints stack rollout checklist and
   default binding snippets for `astro_repo`.
5. **Conformance suite.** `packages/workflows/test/capability-conformance.test.ts`
   asserts catalog ↔ policies ↔ contracts ↔ migrations ↔ runtime registry
   alignment for every loaded tool.
6. **Post-ship audit skill.** `.cursor/skills/test-tool/` runs client-realistic
   scenario audits after ship (Telegram copy, CTAs, state machine, customization
   scope). Uses conformance and unit tests as baseline; output in `docs/audits/`.
   Optional phase after create-tool; documented in `docs/TESTING.md`.

Destructive capabilities (e.g. delete project) must complete the brief and
platform-gap ADR before catalog registration.

## Consequences

- New tools start from a brief + scaffold instead of copying blog/project folders
  by hand.
- Scaffolder does not patch existing TypeScript registries automatically; snippets
  remain explicit to avoid silent merge errors.
- Dry-run briefs (`delete_project_astro`) validate the pipeline without entering
  the live catalog; destructive graph coherence failures are expected until the
  brief is rewritten per `graph-by-mutation.md`.
- Telegram inline button **labels** are documented per capability and decision
  surface in the skill; authors must not reuse create-flow CTAs on destructive tools.

## Verification

- `pnpm --filter @binflow/tools test`
- `pnpm --filter @binflow/workflows test`
- `scaffold-tool.ts --dry-run briefs/delete_project_astro.brief.yaml`
- Docs: `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/CHANGELOG.md`
