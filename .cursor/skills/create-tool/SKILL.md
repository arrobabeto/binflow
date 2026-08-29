# Create Tool (human-in-the-loop pipeline)

Create a new Binflow capability in one guided run: interview → brief → scaffold →
implement → post-ship → conform.

## Preconditions

1. Read `docs/README.md`, ADR-0030, ADR-0038, ADR-0039, and `packages/tools/README.md`.
2. Confirm behavior is documented; add or amend an ADR when trust boundaries change.
3. Destructive tools (`mutationClass: destructive`) require **ADR-0040** gap review
   before catalog registration (GitHub DELETE, verification semantics, tombstone,
   no Vercel preview unless explicitly documented).

## Phase 0 — Interview (human gates)

Run `.cursor/skills/create-tool/references/interview.md` phase by phase. After each
phase, summarize decisions and wait for user confirmation before continuing.

Key references during interview:
- `references/graph-by-mutation.md` — node naming by mutation class
- `references/client-facing-copy.md` — Telegram / admin copy rules
- `references/post-ship-ops.md` — migrate, bindings, rematerialize

Output: `packages/tools/briefs/<capability_id>.brief.yaml`

## Phase 1 — Scaffold

The brief **must** declare `identity.stack`, `identity.profile`, and
`migration.allowedProfiles` (same profile values). This is the assignment gate:
dashboard and `PUT .../capabilities` only bind the tool to projects whose
`projects.profile` is in `allowedProfiles`. The scaffolder registers the
definition; it does **not** enable the tool on any client.

```bash
pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/<id>.brief.yaml --dry-run
pnpm --filter @binflow/tools exec tsx scripts/scaffold-tool.ts briefs/<id>.brief.yaml
```

Review generated files and paste manual snippets + **stack rollout checklist** from stdout.

## Phase 2 — Implement executor + runtime

1. Reuse an executor family when possible (`blog`, `project`) or add a new package.
2. Wire `onStage` callbacks to graph **node ids** from the brief (exact match).
3. Register `executorId` in `capability-runtimes.ts` (fail-closed if missing).
4. Pass `capabilityId` into OpenAI generation ports.

## Phase 3 — Ingress, copy, notifications

1. Telegram command + NL matcher (conjugations; destructive-before-create when applicable).
2. Plan confirm / collection copy per `client-facing-copy.md`.
3. **Inline CTAs** per decision surface — export `*ActionLabels` in `*-ingress.ts`;
   do not reuse `localeCopy.confirm` outside create tools.
4. Admin outbox messages with client + action + request id (+ PR when applicable).
5. Tests: `packages/workflows/test/*-ingress.test.ts` (messages + button labels).

## Phase 4 — Post-ship ops

Follow `references/post-ship-ops.md`:

```bash
pnpm db:migrate   # before dashboard assignment
pnpm --filter @binflow/tools build   # after tool.yaml version bumps
```

Add stack default binding in policies; rematerialize manifests if `editablePaths` changed.

## Phase 5 — Verify

```bash
pnpm --filter @binflow/tools test
pnpm --filter @binflow/workflows test
pnpm --filter @binflow/policies test
```

Conformance: `packages/workflows/test/capability-conformance.test.ts`

Graph coherence: read node list aloud (see `graph-by-mutation.md` review gate).

## Phase 6 — Docs

Update per `.cursor/skills/create-tool/references/checklist.md`:
`docs/specs/`, ADR, `docs/CONTRACTS.md`, `docs/WORKFLOWS.md`, `docs/TELEGRAM.md`,
`docs/TESTING.md`, `docs/CHANGELOG.md`.

Pilot customization: `docs/customizations/<client>-<tool>.md` + upload script if Webbin.

## Never

- Register destructive tools without closing ADR-0040 platform gaps.
- Put model/effort in customization markdown.
- Expose repo paths, SHAs, or raw UUIDs in client-facing copy.
- Reuse create CTAs (`Crear borrador` / `Create draft`) on destructive or update tools — define `*ActionLabels` per capability.
- Reuse `create_draft` / `wait_preview` node ids on destructive tools.
- Assign tool in dashboard before `pnpm db:migrate`.
- `UPDATE` rows in `capability_definitions` (append-only — insert new version).
- Hardcode `capabilityVersion: 1` or default `graphVersionForCapability(..., 1)` after a catalog version bump — use definition version or omit for latest (`post-ship-ops.md` §7).
- Skip conformance tests or leave unknown capabilities fail-open in the worker.
- Edit the attached plan file.

## References

- `references/interview.md` — phased question bank
- `references/layers.md` — code / manifest / customization split
- `references/graph-by-mutation.md` — node naming by mutation class
- `references/client-facing-copy.md` — Telegram / admin copy
- `references/post-ship-ops.md` — migrate, bindings, rematerialize
- `references/checklist.md` — layer checklist
- `references/templates/spec-template.md` — capability spec skeleton
- `references/templates/adr-template.md` — ADR skeleton
