# Discovery checklist (Phase 1)

Complete before generating scenarios. Record answers in the **Tool profile** table.

## Catalog and graph

- [ ] `toolId`, `executorId`, `mutationClass`, `requiresPreview`
- [ ] `packages/tools/stacks/<stack>/<tool>/tool.yaml` version
- [ ] `graph.yaml` node ids in execution order; labels match semantics
- [ ] Interrupt nodes (`awaiting_*`) and who approves (client vs admin)
- [ ] Effect nodes and external permissions (GitHub, Vercel, OpenAI)

## Policies and contracts

- [ ] `packages/policies` definition: version, `allowedProfiles`, approval policy
- [ ] Contracts input schema modes (`collect`, `plan`, `execute`, …)
- [ ] Typed errors in spec vs `DomainError` metadata in code

## Telegram ingress

- [ ] Slash command(s) and NL matcher (`capability-ingress.ts`, `*-ingress.ts`)
- [ ] Decision surfaces: collection, URL confirm, plan confirm, preview, revision, cancel
- [ ] `*ActionLabels` export per capability (not shared create CTAs)
- [ ] Admin notification copy (text-only vs inline buttons)

## Runtime and worker

- [ ] Runtime class (`blog-runtime`, `delete-blog-runtime`, `project-runtime`)
- [ ] `capability-runtimes.ts` registry entry
- [ ] If graph has `catalog_sync`: `parameters.catalogScope` is `blog` or `portfolio`
  and matches `catalogScopeForRuntimeKind` (ADR-0042)
- [ ] `recordFailure` behavior: `FAILED_RETRYABLE` vs `FAILED_FINAL`
- [ ] Publish path: revalidate rules, verify production semantics

## Manifest (client project)

- [ ] `content.collections` / `content.portfolio` paths
- [ ] `editablePaths` covers deletion scope (content paths; redirects deferred per ADR-0041)
- [ ] `repository.branchPattern`, `productionBranch`
- [ ] Profile gate: project `profile` in tool `allowedProfiles`

## Customization (`auditMode=customized`)

- [ ] `docs/customizations/<client>-<tool>.md` on disk
- [ ] Active row in `project_tool_customizations` (version, hash)
- [ ] `content_schema` fields: id, type, ask per locale
- [ ] Confirm asks do not mention models, paths, or repo internals

## Testing baseline

- [ ] `docs/TESTING.md` rows for this capability
- [ ] `packages/workflows/test/*-ingress.test.ts` exists
- [ ] Conformance test includes tool in catalog load set
- [ ] Post-ship ops done: migrate, binding, rematerialize if paths changed

## Tool profile output (template)

| Field | Value |
|-------|-------|
| toolId | |
| mutationClass | |
| requiresPreview | |
| approval | client / admin / both |
| executorId | |
| graph version | |
| Telegram command | |
| NL stems | |
| interrupt nodes | |
| typed errors | |
| manifest deps | |
| custom fields | |
