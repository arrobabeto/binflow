# Audit: edit_image_shopify (base) — 2026-09-04

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | edit_image_shopify |
| stack | shopify-liquid |
| auditMode | base |
| clientKey | — |
| locale | en |
| depth | standard |
| environment | offline |

## Summary

- **Pass:** automated baseline green; live Telegram scenarios **unverified-live**
- **Blockers:** 0 for offline ship gate
- **Major:** 1 (live preview UX not exercised)
- **Top actions:**
  1. Enroll elayva on `shopify_liquid`, migrate `0033`/`0034`, assign tool
  2. Live smoke: `/edit_image` → hero slot → photo → PR preview approve path
  3. Confirm production button host = enrolled `productionDomain` (ADR-0048)
  4. Add ingress unit coverage for shopify collection CTAs if gaps remain
  5. Rematerialize after first assignment

## Tool profile

| Field | Value |
|-------|-------|
| Mutation class | update |
| Preview | PR URL + storefront `?binflow_preview=` query (no Vercel) |
| Approvals | client preview → admin → merge |
| Telegram | `/edit_image` + NL edit-image phrases |
| Allowlist | Surface Inventory `kind: image` + `github_theme` |
| Profiles | `shopify_liquid` only |
| Executor | `workflow.edit_image_shopify@1` |

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass | 10 tools; shopify profile asserted |
| @binflow/workflows capability-conformance | pass | executor registered |
| @binflow/policies test | pass | registry length 10 |
| @binflow/images test | pass | inventory parse/search |
| @binflow/manifests test | pass | shopify empty catalog / no Vercel |
| @binflow/worker build | pass | after restorePreview no-op |

## Findings

| ID | Severity | Layer | Finding | Status |
|----|----------|-------|---------|--------|
| SHOP-IMG-01 | major | code | Live Telegram/preview path not run (offline audit) | open |
| SHOP-IMG-02 | minor | manifest | Inventory recommended; missing → fail closed at tool time (by design) | accepted |
| SHOP-IMG-03 | info | code | Preview is PR + storefront query, not Shopify theme editor preview id | accepted ADR-0059 |

## Scenario matrix (offline)

| ID | Scenario | Automated | Live |
|----|----------|-----------|------|
| IMG-01 | Inventory missing fails closed | covered (unit) | unverified-live |
| IMG-02 | Search by bf_id / section | covered (unit) | unverified-live |
| IMG-03 | Ambiguous → numbered pick | ingress shared with edit_image labels | unverified-live |
| IMG-04 | Replacement photo/URL | shared collection | unverified-live |
| IMG-05 | Preview notice includes PR + preview URL | worker notify wired | unverified-live |
| IMG-06 | Client then admin before merge | graph + runtime | unverified-live |
| IMG-07 | Astro edit_image unchanged | conformance + freeze | n/a |

## Verdict

**Offline ship gate: PASS** with follow-up live smoke on elayva after enrollment + migrate + assign.
