# Audit: delete_project_astro (base) — 2026-08-28

Post-ship audit of `delete_project_astro@2` using the test-tool skill at
`standard` depth. No live pilot requests exist yet; live scenarios are traced
from code and marked **unverified-live**.

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | `delete_project_astro` |
| auditMode | base |
| clientKey | — |
| locale | `es` |
| depth | standard |
| environment | offline (Postgres/Redis up; worker not running; capability not bound locally) |

## Summary

- **Pass:** 16 / **Total:** 22
- **Blockers:** 0
- **Major:** 0 open (F-01, F-02 fixed 2026-08-28)
- **Top actions:**
  1. Split delete-project client notices from blog copy in `@binflow/messaging`
  2. Bind `delete_project_astro@2` on Webbin manifest + run `local-live` pilot
  3. Add ingress test for NL dispatch priority vs create-project
  4. Declare `catalogScope: portfolio` on `catalog_sync` node (tool isolation ADR follow-up)
  5. Re-run audit at `local-live` after first successful delete

## Tool profile

| Field | Value |
|-------|-------|
| toolId | `delete_project_astro` |
| mutationClass | `destructive` |
| requiresPreview | `false` |
| approval | admin-only (`webbin-project-deletion@1`) |
| executorId | `workflow.delete_project@1` |
| graph version | `stacks/astro_repo/delete-project@1` (catalog `@2`) |
| Telegram command | `/delete_project` |
| NL stems | delete verbs + portfolio cues (`proyecto`, `portafolio`, …) |
| interrupt nodes | `awaiting_admin_approval` |
| typed errors | `project_not_found`, `ambiguous_title`, `route_still_live` |
| manifest deps | portfolio collections, cover `.avif`/`.jpg`, editable paths |
| custom fields | none (base); `targetTitle`, `targetUrl` in content_schema |

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass | 18 tests; delete_project in catalog, no `wait_preview` |
| @binflow/workflows test | pass | includes `delete-project-ingress.test.ts` |
| @binflow/policies test | pass | `webbinDeleteProjectCapabilityBinding`, admin policy |
| capability-conformance.test.ts | pass | registry + graph version alignment |
| @binflow/projects test | pass | `delete-project.test.ts` — paths, slug, title resolve |

## Findings

| ID | Severity | Scenario | Observation | Layer | Fix | Status |
|----|----------|----------|-------------|-------|-----|--------|
| F-01 | major | DEL-04, DEL-05 | Admin-pending and completion notices say **artículo** / **article**, not proyecto | code | `contentKind: 'portfolio'` in `@binflow/messaging` + worker wiring | fixed |
| F-02 | major | COM-08, all live | `delete_project_astro` not in local Webbin `enabledCapabilities`; zero requests in DB | manifest/ops | Migration `0023` + `add-webbin-delete-project-binding.ts` | fixed |
| F-03 | minor | POL-02 | `catalog_sync` shares `content.catalog_sync@1` with create blog without declarative `catalogScope` | code | Add `parameters.catalogScope: portfolio` + conformance assert (planned ADR-0042) | open |
| F-04 | info | — | Worker uses `contentKinds: ['portfolio']` for delete_project (recent fix); not covered by conformance test | code | Extend conformance or worker unit test for scoped catalog factory | open |
| F-05 | minor | COM-03 | No automated test that NL *"Borra el proyecto X"* routes to delete_project before create_project | code | Add ingress dispatch test in `delete-project-ingress.test.ts` or workflow integration | open |
| F-06 | info | POL-02 | Graph edge `awaiting_admin_approval → merge_or_publish` uses predicate `approval.client_publish` (misleading name; runtime is admin-only) | code | Document or rename predicate in future catalog pass | open |

### F-01 — Blog copy reused for portfolio delete notifications

- **Scenario:** DEL-04, DEL-05
- **Severity:** major
- **Layer:** code
- **Observation:** [apps/worker/src/main.ts](apps/worker/src/main.ts) calls shared
  `renderDeleteAdminPendingNotice` / `renderDeletePublicationCompleteNotice` for
  both `delete_blog` and `delete_project`. Copy in
  [packages/messaging/src/index.ts](packages/messaging/src/index.ts) references
  *artículo* / *article* in all locales.
- **Suggested fix:** Per-capability copy (mirror `deleteProjectActionLabels` pattern
  in ingress) or pass `contentKind: 'blog' | 'portfolio'` into render helpers.
- **Status:** open

### F-02 — Capability not enabled locally

- **Scenario:** COM-08
- **Severity:** major (operational)
- **Layer:** manifest
- **Observation:** Active Webbin manifest lists `create_blog_draft`,
  `create_project_astro`, `delete_blog_draft` only — not `delete_project_astro@2`.
- **Suggested fix:** Apply migration `0023`, append binding from
  `webbinDeleteProjectCapabilityBinding`, rematerialize if needed.
- **Status:** open

## Scenario results

| Scenario | Auto | Live | Result | Notes |
|----------|------|------|--------|-------|
| COM-01 | pass | unverified | pass | Guidance strings in workflow copy |
| COM-02 | pass | unverified | pass | NL matcher tested |
| COM-03 | partial | unverified | pass* | *no dispatch-order test |
| COM-04 | pass | unverified | pass | collection score logic |
| COM-05 | pass | unverified | pass | plan shows title + URL only |
| COM-06 | — | unverified | unverified | cancel path not traced |
| COM-07 | — | unverified | unverified | no duplicate-run evidence |
| COM-08 | pass | pass | pass | not-enabled reply when unassigned |
| DEL-01 | pass | unverified | pass | URL confirm surface in ingress |
| DEL-02 | pass | unverified | pass | `Borrar proyecto` CTA |
| DEL-03 | pass | unverified | pass | `project_not_found` + FAILED_FINAL |
| DEL-04 | pass | unverified | pass | F-01 fixed — portfolio copy |
| DEL-05 | pass | unverified | pass | F-01 fixed — portfolio copy |
| DEL-06 | pass | unverified | pass* | *404 verify in executor; no live curl |
| DEL-07 | pass | unverified | pass | optional `.jpg` in deletion paths |
| DEL-08 | pass | unverified | pass | delete runtime skips preview status gate |
| POL-01 | pass | unverified | pass | `requiredApprovals: ['admin']` |
| POL-02 | pass | unverified | pass | no `wait_preview` in graph |
| POL-04 | pass | — | pass | fail-closed registry |
| POL-05 | pass | — | pass | catalog `@2` loads |

## Test gaps

- DEL-04 / DEL-05: no messaging test asserting portfolio-specific client copy
- COM-03: no test that delete-project NL wins over create-project when both match portfolio cues
- DEL-06: no E2E production 404 curl for portfolio routes in CI
- F-04: no conformance test for GitHub catalog `contentKinds` per capability
- Live end-to-end: no pilot delete_project request has been executed

## Suggested preventive actions

1. Add messaging tests for delete_project admin-pending and completion copy.
2. Add create-tool antipattern: shared destructive notices must be capability-aware.
3. Complete tool-isolation ADR: `catalogScope` in node.yaml + conformance.
4. Add `DEL-PROJECT-*` rows to `docs/TESTING.md` scenario matrix (mirror delete blog).
5. Run `local-live` pilot on a disposable portfolio slug before production use.

## Follow-ups

- [ ] Fix F-01 (messaging copy)
- [ ] Enable capability on Webbin (F-02)
- [ ] `local-live` re-audit after first successful delete
- [ ] Optional: customized audit (`webbin`) once base pilot passes
