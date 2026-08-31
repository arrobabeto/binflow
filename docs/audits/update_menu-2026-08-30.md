# Audit: update_menu (base) — 2026-08-30 (re-run)

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | `update_menu` |
| stack | `astro-orbitype` |
| auditMode | base |
| clientKey | — (pilot reference: Bistro) |
| locale | es |
| depth | standard |
| environment | offline |

### Delta since prior run (~22:21)

| Check | Prior | Now |
|-------|-------|-----|
| `pnpm db:migrate` | not run | **done** — `update_menu@1` in `capability_definitions` |
| Dashboard binding (Bistro) | unknown | **missing** — only `create_blog_orbitype` bound |
| Bistro manifest `editablePaths` | likely stale | **still missing** `public/documents/*.pdf` (v5 validated) |
| Worker/API live | stopped | **stopped** |

Post-ship gate for `local-live` remains **open**.

## Summary

- **Pass:** 15 / **Total:** 28 (standard matrix)
- **Blockers:** 2 — Bistro tool not assigned; manifest lacks PDF editable path
- **Major:** 4 — customization keywords not wired; 8-button Telegram cap; thin tests; no executor integration test
- **Top actions:**
  1. Assign `update_menu@1` to Bistro in dashboard (or insert binding on active manifest)
  2. Rematerialize Bistro manifest (`public/documents/*.pdf` in `editablePaths`)
  3. Wire `menuCtaKeywords` from customization into discovery
  4. Add ingress/PDF/executor tests; address 8-CTA limit
  5. Re-run with `environment=local-live` after 1–2

## Tool profile

| Field | Value |
|-------|-------|
| toolId | `update_menu@1` |
| stack | `astro-orbitype` / profile `astro_orbitype` |
| mutationClass | `update` |
| requiresPreview | `false` |
| approval | Client only at plan confirm (`confirm_plan` → `QUEUED` → execute) |
| executorId | `workflow.update_menu@1` |
| graph version | `stacks/astro-orbitype/update-menu@1` |
| Telegram command | `/update_menu` |
| NL stems | `actualizar menú`, `subir carta`, `menu pdf`, `update menu`, `Speisekarte aktualisieren`, … |
| interrupt nodes | None (no `wait_preview` / client preview approval) |
| typed errors | See `docs/specs/update-menu.md` §6 |
| manifest deps | `public/documents/*.pdf`, `deployment.productionOrigin`, `contentLocales` |
| productionOrigin | Required (ADR-0048) |
| custom fields | `menu_cta_keywords` in bistro doc — **not loaded in code** |

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| `@binflow/tools` test | pass | 18/18 |
| `@binflow/workflows` test | pass | 28 passed |
| `@binflow/policies` test | pass | 9/9 |
| `capability-conformance.test.ts` | pass | 7/7 |
| `@binflow/menu` test | pass | 3/3 helpers |
| `@binflow/messaging` test | pass | 25/25; no PDF cases |

## DB verification (re-run)

```sql
-- capability_definitions
update_menu | 1 | /update_menu | workflow.update_menu@1 | requires_preview = false

-- Bistro active manifest (v5 validated) editablePaths — NO public/documents/*.pdf
-- project_capability_bindings for bistro: create_blog_orbitype only (no update_menu)
```

## Findings

| ID | Severity | Scenario | Observation | Layer | Status |
|----|----------|----------|-------------|-------|--------|
| F-01 | ~~blocker~~ **major** | STK-AO-01 | Migration applied; **tool not assigned** to Bistro | manifest/ops | open |
| F-02 | blocker | UPD-M04 | Bistro manifest v5 lacks `public/documents/*.pdf` | manifest | open |
| F-03 | major | CUS-* | `menuCtaKeywords` not wired to `discoverMenuCtas` | code/customization | open |
| F-04 | major | UPD-M03 | `discovered.slice(0, 8)` caps Telegram toggles | code | open |
| F-05 | major | COM-02, UPD-M01 | Ingress/PDF tests thin or missing | code | open |
| F-06 | major | UPD-M07 | No `UpdateMenuExecutor` integration test | code | open |
| F-07 | minor | COM-05 | Cancel label hardcoded `Cancelar` | code | open |
| F-08 | minor | brief | Missing `bistro-astro-orbitype-manifest.json` fixture | docs | open |
| F-09 | info | — | OpenAI credential still required for execute context | code | open |
| F-10 | info | — | ADR-0049 still **Proposed** | docs | open |

**Resolved since prior run:** capability row exists after `pnpm db:migrate`.

## Scenario results

| Scenario | Auto | Live | Result | Notes |
|----------|------|------|--------|-------|
| COM-01 | gap | skip | unverified-live | |
| COM-02 | gap | skip | unverified-live | NL matcher untested |
| COM-05 | partial | skip | pass (offline) | Plan labels only |
| COM-08 | pass | skip | pass (offline) | No binding → tool effectively disabled for Bistro |
| UPD-M02 | partial | skip | pass (offline) | Unit test |
| UPD-M05 | pass | skip | pass | No preview nodes |
| UPD-M06 | partial | skip | pass (offline) | Path builder test |
| POL-02 | pass | skip | pass | |
| POL-04 | pass | skip | pass | Conformance |
| POL-05 | pass | skip | pass | |
| STK-AO-01 | gap | skip | fail (F-01,F-02) | Blocked |
| STK-AO-02 | n/a | n/a | skip | No preview |
| STK-AO-03 | gap | skip | unverified-live | |
| *(remaining standard rows)* | gap | skip | unverified-live | Same as prior audit |

## Test gaps

Unchanged from prior run — see §Suggested preventive actions.

## Suggested preventive actions

1. Assign `update_menu@1` to Bistro (`client_publish`).
2. Run `refresh-bistro-manifest-blog-paths.ts` (includes `public/documents/*.pdf`).
3. Add collection + PDF messaging tests.
4. Wire customization keywords; re-audit `auditMode=customized`, `clientKey=bistro`.
5. Live smoke: `/update_menu` → PDF → select → plan confirm → production PDF URL.

## Follow-ups

- [x] `pnpm db:migrate`
- [ ] Dashboard assign `update_menu` to Bistro
- [ ] Rematerialize Bistro manifest
- [ ] Re-run `local-live` audit
- [ ] Code fixes for F-03–F-06
