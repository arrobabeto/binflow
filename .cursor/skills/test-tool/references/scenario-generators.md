# Scenario generators (Phase 2)

Generate scenarios from sections **A–E**. Assign IDs: `{PREFIX}-{NN}`.

Prefixes: `COM` (common), `CRE`, `DEL`, `PRJ`, `UPD`, `CUS` (customized).

---

## A — Standard (all Telegram-exposed tools)

| ID | Given | When | Then | Expected state |
|----|-------|------|------|----------------|
| COM-01 | Tool assigned, paired client | Empty slash command | Bot returns guidance | — |
| COM-02 | Tool assigned | NL happy path (locale param) | Reaches plan or collection | `NEEDS_INPUT` or plan surface |
| COM-03 | Tool assigned | NL with conjugation/typo near stem | Routes to same tool | Not wrong capability |
| COM-04 | Partial input | Follow-up message | Asks only missing field | `NEEDS_INPUT` |
| COM-05 | Plan shown | Inspect copy + buttons | Title/URL human-readable; CTA matches mutation | — |
| COM-06 | Before execute | Client cancels | Request cancelled or stays pre-queue | `CANCELLED` or pre-execute |
| COM-07 | Duplicate message | Same intent twice | Idempotent or clear second reply | No duplicate PRs |
| COM-08 | Tool not assigned | Client invokes | Clear not-enabled message | No request created |

---

## B — Overlays by mutationClass

### `create` (`create_blog_draft`) — prefix `CRE`

| ID | Given | When | Then | Expected state |
|----|-------|------|------|----------------|
| CRE-01 | Topic provided | Execute completes | Preview deploy + client approval surface | `AWAITING_CLIENT_APPROVAL` |
| CRE-02 | Preview ready | Client approves | Queues publish | `APPROVED_FOR_PUBLISH` |
| CRE-03 | Preview ready | Client requests revision | Revision plan flow | `awaiting_revision_*` |
| CRE-04 | Preview ready | Client cancels | Cancelled before merge | `CANCELLED` |
| CRE-05 | New category | Client approves preview | Admin approval required | `AWAITING_ADMIN_APPROVAL` |
| CRE-06 | Image attached (if supported) | Execute | Cover in artifact set | `GENERATING` → preview |

### `destructive` (`delete_blog_draft`) — prefix `DEL`

| ID | Given | When | Then | Expected state |
|----|-------|------|------|----------------|
| DEL-01 | Published article | Title-only input | URL confirm before plan | Confirm surface |
| DEL-02 | Published article | Plan confirm | CTA is delete-specific (`Borrar artículo`) | `QUEUED` on confirm |
| DEL-03 | Article already deleted | Re-request delete | `article_not_found`; no plan/PR | `FAILED_FINAL` or early abort |
| DEL-04 | Deletion PR open | Client message | Text-only admin-pending; **no** PR preview buttons / Cancel | — |
| DEL-05 | Admin approved | Publish completes | Text-only completion notice | `COMPLETED` |
| DEL-06 | Merge done | Hit old article URL | 404 (redirects deferred per ADR-0041) | Production verify pass |
| DEL-07 | Article with optional missing `.avif` | Execute | PR opens without failing on missing cover | `AWAITING_ADMIN_APPROVAL` |
| DEL-08 | Admin approves before Vercel preview checks green | Publish | Merge succeeds (no preview status gate) | not stuck `REVALIDATING` |

**Regression lessons (mandatory in `standard`):** DEL-03, DEL-04, DEL-06, DEL-08; graph version latest catalog; deletion PR removes content paths only (no `_redirects` upsert until ADR-0041 reversed).

### `create` portfolio (`create_project_astro`) — prefix `PRJ`

| ID | Given | When | Then | Expected state |
|----|-------|------|------|----------------|
| PRJ-01 | NL portfolio brief | First message | `NEEDS_INPUT` until base + schema closed | `NEEDS_INPUT` |
| PRJ-02 | Missing fecha/name | Follow-up | Single-field ask | `NEEDS_INPUT` |
| PRJ-03 | Photo on DM | Upload | AVIF cover path; not `[image]` text closure | `GENERATING` |
| PRJ-04 | Preview ready | Client approves | Publish path | per policy |
| PRJ-05 | Similar slug exists | Execute | Collision error surfaced | typed error |

### `update` — prefix `UPD`

| ID | Given | When | Then | Expected state |
|----|-------|------|------|----------------|
| UPD-01 | Revision requested | Plan confirm/adjust/cancel | Correct CTAs per ADR-0032 | revision nodes |
| UPD-02 | Cancel revision | Client cancels | Restores prior approval state | `AWAITING_CLIENT_APPROVAL` |

### `read_only` — prefix `RD`

| ID | Given | When | Then | Expected state |
|----|-------|------|------|----------------|
| RD-01 | Invoke tool | Complete flow | No publication nodes | no merge/publish |

---

## C — Policy / ADR overlays

| ID | Applies to | Given | When | Then |
|----|------------|-------|------|------|
| POL-01 | destructive | Client requests delete | Tries to approve publish | Denied — admin only |
| POL-02 | destructive | Delete execute | Inspect graph | No `wait_preview`; `requiresPreview=false` |
| POL-03 | destructive | After merge | Verify | 404 on deleted routes (redirects deferred) |
| POL-04 | all | Unknown capability in job | Worker resolves runtime | Fail closed (no blog fallback) |
| POL-05 | all | Version bump in catalog | New request | Uses latest graph version |

---

## D — Customized-only (`auditMode=customized`)

For each `content_schema` field in client customization:

| ID | Given | When | Then |
|----|-------|------|------|
| CUS-{field}-01 | Empty field | Bot ask | Ask matches customization; locale correct |
| CUS-{field}-02 | Valid value | Submit | Closes field; does not poison other fields |
| CUS-{field}-03 | URL in text field | Submit | Parsed as URL type when `type: url` |

**Webbin `delete_blog_draft` seed:**

| Field | CUS ID | Ask under test |
|-------|--------|----------------|
| targetTitle | CUS-targetTitle-01 | Combined title/URL guidance |
| targetUrl | CUS-targetUrl-01 | Public URL ask |

Compare asks to stack `customization-template.md`: customization should improve clarity, not expand scope.

---

## F — Stack overlays (from stack contract)

Apply when `stack` is set. Prefixes: `STK`.

### `astro-repo` (Webbin)

| ID | Given | When | Then |
|----|-------|------|------|
| STK-AR-01 | Publish complete | Open production Telegram button | Host is webbin.com.mx (pilot) |
| STK-AR-02 | Preview ready | Open preview CTA | Routes under `/articulos` or `/proyectos` as applicable |

### `astro-orbitype`

| ID | Given | When | Then |
|----|-------|------|------|
| STK-AO-01 | Publish complete | Open production Telegram button | Host == enrollment `productionDomain` (not webbin.com.mx, not `*.vercel.app`) |
| STK-AO-02 | Preview ready | Open preview CTA | Path `/posts/{id}/{titleSlug}` |
| STK-AO-03 | Orbitype draft node | CMS write | Real schema columns; no invent-column retry storm |
| STK-AO-04 | Preview deploy | Vercel build | Preview has required `PUBLIC_*` env |
| STK-AO-05 | Two projects, same GitHub PR # | Persist PR row | No unique collision; not stuck `PREVIEW_DEPLOYING` |
| STK-AO-06 | Live worker | Bot `/status` | Polling (not send-only); single worker |

Include STK-AO-* in `standard`/`deep` for Orbitype tools; smoke at least STK-AO-01 + STK-AO-02 when `local-live`.

---

## E — Depth filter

| Depth | Include |
|-------|---------|
| `smoke` | COM-01, COM-02, COM-05, COM-08 + 1 mutation overlay (e.g. DEL-02 or CRE-01) + stack smoke (STK-*-01) |
| `standard` | All of A + full B for tool's mutationClass + D if customized + POL rows for class + F for stack |
| `deep` | standard + `docs/TESTING.md` § Failure and recovery + cross-locale (EN/DE) + concurrent duplicate approval |

---

## Mapping to automated tests

| Scenario | Likely test file |
|----------|------------------|
| COM-05, DEL-02 | `packages/workflows/test/delete-blog-ingress.test.ts` |
| DEL-03 | `packages/blog/test/delete-blog.test.ts`, ingress tests |
| POL-04, POL-05 | `capability-conformance.test.ts` |
| CRE-* | `packages/workflows/test/workflow.test.ts`, `blog.test.ts` |
| PRJ-* | `packages/projects/test/projects.test.ts` |
| STK-AO-* | `packages/vercel`, `packages/orbitype`, `packages/manifests`, blog preview route tests |

Mark **gap** when scenario has no test mapping.
