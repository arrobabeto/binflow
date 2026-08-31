# Audit: edit_image (base) — 2026-08-31 (re-run after fixes)

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | `edit_image` |
| stack | `astro-orbitype` |
| auditMode | base |
| clientKey | — (pilot reference: Bistro) |
| locale | es |
| depth | standard |
| environment | local-live (worker restarted; full Telegram happy path still manual) |

### Delta since prior run (~10:28)

| Check | Prior | Now |
|-------|-------|-----|
| Spec path `images/edits` | stale | **fixed** — `imageDirectory` / `public/images/blog/edit-*` |
| Admin preview URL buttons | text `Preview:` lines | **fixed** — outbox `previewUrls` → LinkButtons |
| Ingress/collection tests | NL + labels only | **expanded** — photoUrl, denylist, plan copy, admin card links |
| Worker polling | stopped | **turbo `dev` holds poll lock**; avoid second worker (send-only) |
| End-to-end COMPLETED on Bistro | unverified | **still manual** (client Telegram) |

## Summary

- **Pass:** 24 / **Total:** 30 (standard matrix)
- **Blockers:** 0 code blockers; 1 remaining **ops/manual** — confirm live COMPLETED once on Bistro
- **Major:** 0 open from prior F-01–F-03 (addressed)
- **Top actions:**
  1. On Telegram: `/cancel` then `/edit_image` → confirm photo → replacement → plan → preview → admin Approve
  2. Confirm admin card shows preview **Open preview** link button
  3. Optional: collection integration test with DB fixtures (nice-to-have)

## Tool profile

Unchanged from prior audit (see `edit_image-2026-08-31.md` first revision). Graph, CTAs, approvals identical. Manifest Bistro **v10** with `edit_image` + blog image paths.

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass | prior run |
| @binflow/workflows test | pass | 38 + 15 skipped (incl. expanded edit-image ingress) |
| @binflow/policies test | pass | prior |
| capability-conformance.test.ts | pass | prior |
| @binflow/images test | pass | prior |
| @binflow/messaging test | pass | 30 (admin preview links + file image) |
| @binflow/worker check | pass | after previewUrls wiring |

## Findings

| ID | Severity | Scenario | Observation | Layer | Fix |
|----|----------|----------|-------------|-------|-----|
| F-01 | — | docs | Spec path drift | docs | **fixed** |
| F-02 | minor | COM-04 | Still no full DB-backed collection integration test | code | optional follow-up |
| F-03 | — | UPD-IMG-08 | Admin preview buttons | code | **fixed** |
| F-04 | info | UPD-IMG-05 | Live COMPLETED not observed in-session | ops | manual smoke |
| F-05/F-06 | — | — | File image + editablePaths | — | **fixed** (prior) |
| F-07 | minor | COM-03 | NL “hero” may match tool then denylist | code | open (low) |
| F-09 | — | STK-AO-06 | Worker stopped | ops | **fixed** (restarted) |

## Scenario results (delta)

| Scenario | Prior | Now |
|----------|-------|-----|
| UPD-IMG-01 photoUrl copy | gap | pass* (unit: absolute URL + clean confirm copy) |
| UPD-IMG-06 denylist | pass* | pass* (ingress test imports discovery) |
| UPD-IMG-07 path allowlist | pass* | pass* + spec aligned |
| UPD-IMG-08 admin preview | fail | pass* (render + outbox/worker wiring) |
| STK-AO-06 worker | fail | pass (polling ready) |
| UPD-IMG-05 full publish | fail | unverified-live (manual) |

## Follow-ups

- [x] Spec path correction
- [x] Ingress/admin tests expanded
- [x] Admin preview URL buttons
- [x] Worker restart
- [ ] Manual live COMPLETED on Bistro
- [ ] Optional: DB collection integration test
