# Audit: create_blog_wordpress (base) — 2026-10-15

## Parameters

| Parameter | Value |
|-----------|-------|
| toolId | `create_blog_wordpress` |
| stack | `wordpress-rest` |
| auditMode | base |
| clientKey | — |
| locale | es |
| depth | standard |
| environment | offline (no Binflow API/worker running, no enrolled WordPress pilot site) |

## Summary

- **Pass:** 18 / **Total:** 27 (all passes are code-trace or unit-test based; every Telegram/WordPress scenario is **unverified-live**)
- **Blockers:** 1
  - F-01 — The interview advances before the client taps **Listo**: multi-message articles are cut, the next message is taken as title/excerpt, and an as-is `# Título` line is published as literal text.
- **Major:** 4 (F-02 post adoption by title, F-03 wrong timeout copy after unlock, F-04 post link host not checked against the enrolled origin, F-05 manual wp-admin publication gets trashed)
- **Top actions:**
  1. Add an explicit "content done" flag to the collection state (F-01, code).
  2. Restrict post adoption to the request's own crash window and exclude posts owned by other open requests (F-02, code).
  3. Re-read the post before any automatic trash and never trash an unprotected post (F-05, code).
  4. Assert the REST `link` host equals the enrolled origin before showing the preview (F-04, code + enrollment doc).
  5. Publish-phase timeout copy must not say "nothing was published" after unlock (F-03, code).

## Tool profile

| Field | Value |
|-------|-------|
| toolId | `create_blog_wordpress@1` |
| stack | `wordpress-rest` (profile `wordpress_rest`) |
| mutationClass | create |
| requiresPreview | true — password-protected live post (ADR-0067) |
| approval | client; admin only when the category is new |
| executorId | `workflow.create_blog_wordpress@1` |
| graph version | `stacks/wordpress-rest/create-blog@1` (15 nodes) |
| Telegram command | `/create_blog` (routed to WordPress when the capability is assigned) |
| NL stems | shared blog natural-language matcher (`naturalBlog`) |
| interrupt nodes | `awaiting_client_approval`, `awaiting_admin_approval` |
| typed errors | `wordpress_route_denied`, `wordpress_timeout`, `wordpress_unavailable`, `wordpress_category_missing`, `wordpress_image_origin_denied`, `wordpress_image_invalid`, `wordpress_preview_not_protected`, `wordpress_post_changed`, `wordpress_publish_unverified`, `wordpress_request_cancelled`, `wordpress_credential_missing` |
| manifest deps | `wordpress.siteOrigin`, `restBase`, `productionOrigin`, `userId`, `username`, `defaultContentLocale`, `budgetPolicy` |
| productionOrigin | enrollment `productionDomain` (host = site origin) |
| custom fields | none (customization only for `generate`, `apply_revision`, `prepare_image`) |
| catalog_sync scope | `blog` |

## Automated baseline (Phase 3)

| Suite | Result | Notes |
|-------|--------|-------|
| @binflow/tools test | pass (18/18) | |
| @binflow/workflows test | 110/113 | 3 failures are pre-existing (`TicketService` ×2, fake-publication approval), identical on a clean `HEAD` worktree |
| @binflow/policies test | pass (9/9) | |
| capability-conformance.test.ts | pass (7/7) | |
| wordpress-blog-content.test.ts | pass (10/10) | |
| @binflow/wordpress test | pass (25/25) | publication port + verifier against fake sites |
| @binflow/messaging test | 33/34 | `telegram-verifier` send-only test needs Redis (not running locally) |

## Findings

| ID | Severity | Scenario | Observation | Layer | Fix |
|----|----------|----------|-------------|-------|-----|
| F-01 | blocker | COM-04, WP-01 | Collection advances on the first message long enough; **Listo** is not required | code | `wordpress-blog-content.ts`, `wordpress-blog-collection.ts`, contracts collect schema |
| F-02 | major | COM-07, WP-05 | `findAdoptablePost` adopts any protected post with the same title by the Binflow user | code | `wordpress-blog-runtime.ts`, `@binflow/wordpress` |
| F-03 | major | STK-WP-04 | Timeout during publish after unlock tells the client "nothing was published" | code | `apps/worker/src/wordpress-blog-job.ts`, copy |
| F-04 | major | STK-WP-01 | REST `link` host is never checked against the enrolled origin | code | runtime `upsert_protected_post`, ENROLLMENT.md |
| F-05 | major | STK-WP-06 | A post made public manually in wp-admin is trashed on approval | code | `wordpress-blog-runtime.ts` (`reopen`, `recordFailure`) |
| F-06 | minor | CRE-03 | Revision feedback reply says "Preparando el plan de cambio"; WordPress has no plan step | code | `packages/workflows/src/index.ts` copy |
| F-07 | minor | CRE-05 | Admin new-category message has no post link | code | `index.ts` admin message |
| F-08 | minor | COM-08 | Empty `/create_blog` on a WordPress project without the tool shows Astro guidance | code | `index.ts` blog ingress |
| F-09 | info | STK-WP-05 | Sites with trash disabled return 501 on DELETE without `force`; discard keeps failing | code / ops | port typed error + OPERATIONS.md |
| F-10 | info | CRE-04 | Discard job loads the OpenAI credential; a revoked OpenAI key blocks trashing | code | `wordpress-blog-job.ts` |
| F-11 | info | — | `failed` checkpoint always records `requestState: FAILED_FINAL`, even for retryable failures | code | `stageRequestState` |
| F-12 | info | all | No DB-backed runtime test; Telegram rendering unverified-live | test | TESTING.md |

### F-01 — Interview skips ahead before the client taps **Listo**

- **Scenario:** COM-04, WP-01
- **Severity:** blocker
- **Layer:** code
- **Observation:** `nextWordpressBlogStep` has no "content finished" signal. Every text message calls `advance`, which recomputes the step from the content length alone. Reproduced against the built module:
  - As-is, first message ≈280 chars starting with `# Mi titulo de prueba` → step `await_title`. The bot asks for the title although it was given, and the client's second message (the rest of the article) becomes the title (≤200 chars) or is rejected.
  - Because title extraction only happens in the **Listo** handler, the `# …` line stays in the body: `composeAsIsHtml` outputs `<p># Mi titulo de prueba</p>`, so the heading would be published as literal text.
  - Generate, first message of 30 chars → step `choose_category`; further base-information messages get "Usa los botones de arriba".
  - Telegram splits messages over 4 096 characters, so long as-is articles always arrive in several messages.
- **Suggested fix:** add `contentDone: boolean` to the collect schema; `nextWordpressBlogStep` returns `await_content` until it is true; set it (and split the title) only in the `wp_blog_content_done` handler. Add tests: two-message as-is article, `# Título` extraction, generate with three messages.
- **Status:** open

### F-02 — Post adoption by title can hijack another request's preview

- **Scenario:** COM-07, WP-05
- **Severity:** major
- **Layer:** code
- **Observation:** on the first execute attempt (`previous.postId` undefined) the runtime calls `findAdoptablePost(title)`, which returns any published, password-protected post by the Binflow user with the exact title. A second request with the same title (retry by the client, duplicate command, or an old request still awaiting approval) updates the first request's post. Both requests then point at one post: cancelling one trashes the other's preview, and approving one publishes content the other request bound.
- **Suggested fix:** checkpoint a `creatingPost: true` marker before `POST wp/v2/posts` and adopt only when that marker exists; additionally exclude post ids referenced by any other non-terminal `create_blog_wordpress` request in the project.
- **Status:** open

### F-03 — "Nothing was published" after the post is already public

- **Scenario:** STK-WP-04
- **Severity:** major
- **Layer:** code
- **Observation:** the worker sends `wordpressBlogCopy.timeout` ("…no se publicó nada") for any `wordpress_timeout` / `wordpress_unavailable`, including the publish run after `unlock_post` (e.g. the anonymous verification call times out). The post is public at that point. When `wordpress_publish_unverified` exhausts its retries, the request stays `FAILED_RETRYABLE` and the client never receives the published notice.
- **Suggested fix:** choose the copy from the checkpoint (`wordpress.unlocked === true` → "Your post is already public; I am still confirming it"). Document the exhausted-verification recovery in OPERATIONS.md.
- **Status:** open

### F-04 — Post link host not tied to the enrolled origin

- **Scenario:** STK-WP-01
- **Severity:** major (unverified-live)
- **Layer:** code
- **Observation:** the preview and published buttons use the REST `link` as returned by WordPress (`home` setting). Nothing asserts its host equals `wordpress.productionOrigin` / `siteOrigin` (ADR-0048). On sites where `home` differs from the REST origin (www vs apex, WordPress Address ≠ Site Address), the client gets an off-origin button, and after unlock `publicPageStatus` throws `wordpress_url_cross_host` (`policy_denied`, final). The request ends `FAILED_FINAL` while the post is public; the post is not trashed because it is unlocked.
- **Suggested fix:** after `upsert_protected_post`, fail with a typed error (`wordpress_link_off_origin`) before showing the preview if the link host differs; add the `home` vs site-origin check to enrollment validation.
- **Status:** open

### F-05 — Manual wp-admin publication is trashed

- **Scenario:** STK-WP-06
- **Severity:** major
- **Layer:** code
- **Observation:** if an editor removes the password in wp-admin before approval, publish detects drift and calls `reopen`, whose `verifyProtected` throws `wordpress_preview_not_protected` (`provider_final`). `recordFailure` then trashes the post because the checkpoint says `unlocked !== true`, taking down a post a human made public.
- **Suggested fix:** in `recordFailure`, re-read the post and trash only if it is still password-protected; in `reopen`, an unprotected post should end the request with `wordpress_post_changed` and an operator-visible note, without trashing.
- **Status:** open

### F-06 — Revision reply mentions a change plan

- **Scenario:** CRE-03
- **Severity:** minor
- **Layer:** code
- **Observation:** `reviseWordpressBlog` replies with the shared `revisionQueued` copy ("Comentarios guardados. Preparando el plan de cambio."), but WordPress revisions are applied directly with no plan confirmation.
- **Suggested fix:** WordPress-specific copy: "Aplicando tu cambio; te mando el post actualizado para revisar."
- **Status:** open

### F-07 — Admin approves a new category without seeing the post

- **Scenario:** CRE-05
- **Severity:** minor
- **Layer:** code
- **Observation:** the admin message includes topic, capability and request id but no preview link (previewUrls are only attached for image edits).
- **Suggested fix:** attach `terminalResult.previewUrls.post` for `create_blog_wordpress` (the admin can open it with the preview password shared by the operator, or include it in the admin-only channel).
- **Status:** open

### F-08 — Unassigned tool shows Astro guidance

- **Scenario:** COM-08
- **Severity:** minor
- **Layer:** code
- **Observation:** on a `wordpress_rest` project without the tool assigned, an empty `/create_blog` falls through to the Astro path and replies with the `/create_blog <tema>` guidance; the follow-up is then denied (`policy_denied`).
- **Suggested fix:** when the project profile is `wordpress_rest`, reply with `wordpressBlogCopy.notEnabled`.
- **Status:** open

### F-09 — Trash disabled on the site

- **Scenario:** STK-WP-05
- **Severity:** info
- **Layer:** code / ops
- **Observation:** with `EMPTY_TRASH_DAYS = 0`, `DELETE wp/v2/posts/{id}` without `force` returns 501 `rest_trash_not_supported`. Discard fails on every retry and the protected post stays online (still password-protected).
- **Suggested fix:** map to a typed error (`wordpress_trash_unsupported`), alert the operator, and add an enrollment probe/OPERATIONS.md note. `force` stays forbidden (ADR-0067).
- **Status:** open

### F-10 — Discard depends on the OpenAI credential

- **Scenario:** CRE-04
- **Severity:** info
- **Layer:** code
- **Observation:** `loadJobContext` requires an active tenant OpenAI credential for every resume, including `discard_wordpress_post` and `publish`.
- **Suggested fix:** load the OpenAI credential only for `execute` and `apply_revision`.
- **Status:** open

### F-11 — Failed checkpoint state

- **Severity:** info
- **Layer:** code
- **Observation:** `stageRequestState('failed')` returns `FAILED_FINAL`, so the dashboard checkpoint disagrees with the request state on retryable failures.
- **Suggested fix:** pass the real request state as `extraState` from `recordFailure`.
- **Status:** open

### F-12 — Coverage gaps

- **Severity:** info
- **Layer:** test
- **Observation:** see "Test gaps" below.
- **Status:** open

## Scenario results

| Scenario | Auto | Live | Result | Notes |
|----------|------|------|--------|-------|
| COM-01 Empty `/create_blog` | partial (ingress wiring test) | unverified | pass | Mode buttons + Cancel |
| COM-02 NL happy path | — | unverified | pass | Same matcher as other blog tools; no seed text for NL |
| COM-03 NL typo near stem | shared matcher tests | unverified | pass | |
| COM-04 Follow-up asks only missing field | — | unverified | **fail** | F-01 |
| COM-05 Plan copy + buttons | — | unverified | pass | "Crear vista previa protegida" / "Cancelar"; human title |
| COM-06 Cancel before execute | — | unverified | pass | `CANCELLED`, no discard job |
| COM-07 Duplicate request | — | unverified | **fail** | F-02 |
| COM-08 Tool not assigned | — | unverified | **fail** | F-08 |
| CRE-01 Execute → preview | port tests | unverified | pass | Link + password + Approve / Changes / Cancel |
| CRE-02 Approve → publish | port tests | unverified | pass | |
| CRE-03 Revision | — | unverified | **fail** (minor) | F-06 |
| CRE-04 Cancel at preview | port test (trash without force) | unverified | pass | F-10 info |
| CRE-05 New category → admin | — | unverified | pass | F-07 minor |
| CRE-06 Image (photo / site URL / AI) | content tests (URL origin) | unverified | pass | Images sent as a file are refused (info) |
| POL-04 Unknown capability fails closed | conformance | — | pass | |
| POL-05 Latest graph version | conformance | — | pass | |
| STK-WP-01 Button host == enrolled origin | — | unverified | **fail** | F-04 |
| STK-WP-02 Approval binds exact post version | port tests | unverified | pass | `wp:<id>:<modified_gmt>:<hash>` |
| STK-WP-03 Endpoint allowlist in code | port tests | — | pass | |
| STK-WP-04 Timeout notifies client | — | unverified | **fail** | F-03 (copy after unlock) |
| STK-WP-05 Trash never forced | port test | unverified | pass | F-09 info |
| STK-WP-06 wp-admin edit reopens review | — | unverified | **fail** | F-05 (manual unlock case) |
| WP-01 As-is keeps every word | content tests | unverified | **fail** | F-01 (`# Título` leaks; multi-message) |
| WP-02 Off-site image URL refused | content tests | — | pass | |
| WP-03 Cancel race leaves no orphan | — | unverified | pass | Code trace: `persistPreview` refuses + trash |
| WP-04 Final failure trashes protected post | — | unverified | pass | Code trace (see F-05 edge) |
| WP-05 Crash recovery adopts own post | port tests | unverified | **fail** | F-02 |

## Test gaps

- COM-04 / WP-01: no collection test with several content messages or `# Título` extraction.
- COM-07 / WP-05: no test that a second request with the same title gets its own post.
- CRE-01–CRE-05, WP-03, WP-04, STK-WP-06: no DB-backed runtime test (execute, publish, reopen, cancel race, discard).
- STK-WP-01: no test for an off-origin REST `link`.
- Telegram rendering of `**bold**` in plain-text collection replies and of titles containing Markdown characters: unverified-live.

## Suggested preventive actions

1. Collection tests for multi-message content in both modes (F-01).
2. DB-backed runtime suite with the fake WordPress site from `@binflow/wordpress` tests: execute → approve → publish, drift reopen, manual unlock, cancel race, same-title second request.
3. Add a create-tool antipattern: "a collection step that accepts several messages must advance only on an explicit Done action".
4. Enrollment validation: compare WordPress `home` host with the site origin (F-04).
5. Update `docs/specs/create-blog-wordpress.md` § 7–9 once F-02–F-05 are fixed.

## Follow-ups

- [ ] Code PR (F-01–F-08)
- [ ] Doc / ADR update (spec § 7–9, OPERATIONS.md trash-disabled and exhausted verification)
- [ ] TESTING.md rows for the new collection and runtime tests
- [ ] Live smoke on a WordPress pilot site (ADR-0067 verification list)
- [ ] Re-run audit after fix
