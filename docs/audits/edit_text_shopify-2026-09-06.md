# Audit: edit_text_shopify (base) — 2026-09-06 (re-audit)

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | edit_text_shopify |
| stack | shopify-liquid |
| auditMode | base |
| clientKey | — (Elayva assigned) |
| locale | es |
| depth | standard |
| environment | offline |
| prior audit | `docs/audits/edit_text_shopify-2026-09-06.md` findings F-01–F-09 fixed in code/docs |

## Summary

- **Pass:** automated baseline **all green**; offline copy/CTA checks pass
- **Blockers:** 0
- **Major:** 1 remaining — live Telegram/execute/publish still **unverified-live**
- **Top actions:**
  1. Local-live smoke on Elayva: `/edit_text` → intro copy → Approve → admin → merge
  2. Optional: collection ingress tests for Astro-like miss/confirm (browse/deep
     search removed from text flow)
  3. Optional: rename shared `confirm_image_*` action tokens later (labels already text-specific)

## Tool profile

| Field | Value |
|-------|-------|
| toolId | edit_text_shopify |
| stack | shopify-liquid / `shopify_liquid` |
| mutationClass | update |
| requiresPreview | true (SHA binding; no Vercel) |
| approval | client Approve/Cancel → admin → merge |
| executorId | workflow.edit_text_shopify@1 |
| graph | stacks/shopify-liquid/edit-text@1 |
| Telegram | `/edit_text` + shared edit-text NL; prefers Shopify when bound |
| Client notice | Approve/Cancel only (`renderThemeTextApprovalNotice`) |
| Allowlist | inventory `kind: copy` + `github_theme` |

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass | 11 tools |
| @binflow/workflows test | pass | guidance asserts no `bf_id` |
| @binflow/policies test | pass | registry length 11 + `edit_text_shopify` |
| capability-conformance.test.ts | pass | |
| @binflow/text test | pass | schema default patch |
| @binflow/messaging test | pass | theme text notice has no preview/PR links |

## Findings (post-fix)

| ID | Severity | Status | Notes |
|----|----------|--------|-------|
| F-01 | blocker | **fixed** | policies registry length 11 |
| F-02 | major | **fixed** | catalog Approve/Cancel / no storefront preview promise |
| F-03 | major | **fixed** | guidance uses area/section/excerpt |
| F-04 | major | **fixed** | TESTING.md Shopify `/edit_text` row |
| F-05 | major | **open** | live smoke still needed |
| F-06 | minor | **fixed** | conflict_error copy branches for theme text |
| F-07 | minor | **fixed** | “Theme text edit patch…” |
| F-08 | minor | **fixed** | stack contract Telegram § |
| F-09 | info | **fixed** | messaging unit for `renderThemeTextApprovalNotice` |

### F-05 — Live unverified (remaining)

- **Severity:** major (ops)
- **Observation:** Offline re-audit only. Elayva binding + migrate already done; worker/API live path not exercised in this session.
- **Suggested fix:** Single Telegram poller + `BINFLOW_LIVE_EXECUTION_ENABLED`; OPERATIONS Elayva smoke checklist.
- **Status:** open

## Scenario results (re-score)

| Scenario | Auto | Live | Result | Notes |
|----------|------|------|--------|-------|
| COM-01 | pass | unverified-live | pass (offline) | Human guidance; no bf_id |
| COM-05 | pass | unverified-live | pass (offline) | Catalog + Approve/Cancel notice |
| POL-04 / POL-05 | pass | n/a | pass | conformance |
| STK-SL-02 | pass | unverified-live | pass (offline) | No preview/PR buttons in notice |
| TXT-01–04 | pass | unverified-live | pass | inventory / patch / expectedFiles / isolation |
| COM-02–08 | gap/partial | unverified-live | unverified-live | Need live |
| UPD-* | skip | n/a | skip | No revision nodes |

## Test gaps (remaining)

- Full collection miss/confirm ingress suite (optional; browse/deep search N/A).
- Live Telegram matrix (F-05).
- Note (2026-09-07): discovery UX amended to Astro-like text search (ADR-0063 §6).

## Verdict

**Offline ship gate: PASS.** Remaining major is live smoke on Elayva only.
