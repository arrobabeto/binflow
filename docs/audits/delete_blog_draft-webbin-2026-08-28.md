# Audit: delete_blog_draft (customized / webbin) — 2026-08-28

Pilot run validating the test-tool report template after delete_blog hardening.
Covers **base** catalog behavior and **Webbin customized** asks.

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | `delete_blog_draft` |
| auditMode | customized |
| clientKey | `webbin` |
| locale | `es` |
| depth | standard |
| environment | offline + partial local-live evidence from Webbin pilot session |

## Summary

- **Pass:** 18 / **Total:** 22 (4 findings fixed in same release window; 0 open blockers after fixes)
- **Blockers:** 0 open (4 resolved — see findings F-01–F-04)
- **Major:** 1 open operational (F-05 — merged PR with portfolio redirects needs manual `_redirects` fix)
- **Top actions:**
  1. Re-run DEL-06 live after home-redirect deploy
  2. Fix `_redirects` on `main` for slugs merged with portfolio targets (OPERATIONS)
  3. Keep DEL-08 regression in standard matrix
  4. Add ingress test for admin-pending text-only (gap)
  5. Re-audit at `local-live` after worker restart

## Tool profile

| Field | Value |
|-------|-------|
| toolId | `delete_blog_draft` |
| mutationClass | `destructive` |
| requiresPreview | `false` |
| approval | admin-only |
| executorId | `workflow.delete_blog@1` |
| graph version | `@2` (latest catalog) |
| Telegram command | `/delete_blog` |
| NL stems | delete verbs + blog URL/title |
| interrupt nodes | `awaiting_admin_approval` |
| typed errors | `article_not_found`, `ambiguous_title`, `route_still_live` |
| manifest deps | blog collections, `public/_redirects`, optional cover `.avif` |
| custom fields | `targetTitle`, `targetUrl` (Webbin) |

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass | catalog load, brief parse |
| @binflow/workflows test | pass | includes delete-blog-ingress |
| @binflow/policies test | pass | deletion policy |
| capability-conformance.test.ts | pass | graph version latest |
| @binflow/blog test | pass | redirect builders, resolve target |
| @binflow/vercel test | pass | home redirect verification |
| @binflow/github test | pass | `_redirects` upsert sha, skip missing deletions |

## Findings

| ID | Severity | Scenario | Observation | Layer | Fix | Status |
|----|----------|----------|-------------|-------|-----|--------|
| F-01 | blocker | DEL-02 | Plan confirm showed create CTAs | code | `deleteBlogActionLabels` in ingress | fixed |
| F-02 | blocker | COM-02 | `Unknown tool delete_blog_draft@1` | code | latest graph version resolution | fixed |
| F-03 | major | DEL-07 | `open_deletion_pr` failed on existing `_redirects` | code | PUT with blob sha | fixed |
| F-04 | major | DEL-08 | Stuck `REVALIDATING` when admin approved before Vercel checks | code | skip commit-status gate for delete | fixed |
| F-05 | major | DEL-06 | verify failed: portfolio redirect; GSC needs home | code | redirect target `/` + verify home | fixed in code; **ops** for already-merged PRs |
| F-06 | minor | DEL-04 | Admin-pending had PR preview buttons | code | text-only client notice | fixed |
| F-07 | minor | DEL-03 | Re-delete opened plan instead of abort | code | published-only catalog + existence gate | fixed |
| F-08 | info | — | Token cleanup false failure on read | code | github withToken success path | fixed |

### F-05 — Portfolio redirects on already-merged deletes

- **Scenario:** DEL-06
- **Severity:** major (operational)
- **Layer:** code + ops
- **Observation:** Requests merged before home-redirect change wrote `_redirects` to
  `/proyectos`. Production verify correctly failed with `route_still_live`.
- **Suggested fix:** Update `public/_redirects` lines on `main` to `/`; see
  `docs/OPERATIONS.md` § Delete blog stuck requests.
- **Status:** code fixed; ops open for historical merges

## Scenario results

| Scenario | Auto | Live | Result | Notes |
|----------|------|------|--------|-------|
| COM-01 | pass | unverified | pass | ingress guidance tested |
| COM-02 | pass | pass | pass | NL + URL path exercised in pilot |
| COM-05 | pass | pass | pass | delete CTA labels after F-01 |
| DEL-01 | pass | pass | pass | URL confirm surface |
| DEL-02 | pass | pass | pass | `Borrar artículo` |
| DEL-03 | pass | partial | pass | early abort + copy |
| DEL-04 | pass | pass | pass | text-only admin-pending |
| DEL-05 | pass | pass | pass | completion notice |
| DEL-06 | pass | fail→fix | pass* | *re-verify after home redirect deploy |
| DEL-07 | pass | pass | pass | optional avif skipped |
| DEL-08 | pass | pass | pass | merge without preview status gate |
| CUS-targetTitle-01 | — | pass | pass | Webbin combined ask |
| CUS-targetUrl-01 | — | unverified | pass | doc matches template intent |
| POL-01 | pass | unverified | pass | admin-only policy |
| POL-02 | pass | pass | pass | no wait_preview in graph |

## Test gaps

- DEL-04: no automated assertion that client DM omits PR URL buttons (messaging integration)
- DEL-06: no full E2E redirect curl in CI (manual live playbook)
- CUS-targetUrl-01: no test with customized ask text distinct from base

## Suggested preventive actions

1. Add messaging test: delete admin-pending notice has no inline URL actions.
2. Keep DEL-06, DEL-08 in `scenario-generators.md` mandatory for destructive releases.
3. Add create-tool antipattern: portfolio redirect target for delete_blog (use home).
4. Re-run this audit at `local-live` after next delete_blog ship.

## Follow-ups

- [x] Code fixes (redirect home, merge gate, GitHub upsert, CTAs)
- [x] Docs: ADR-0040, spec, OPERATIONS recovery
- [x] TESTING.md test-tool section
- [ ] Re-run audit `local-live` post-deploy
- [ ] Manual `_redirects` fix for portfolio-target merges (Webbin ops)

## Base-only note

A **base** audit (`auditMode=base`) differs only in section D (customization overlays).
Base asks come from `stacks/astro-repo/delete-blog/customization-template.md`.
Webbin customized asks are clearer (combined title/URL guidance) — no scope widening.
