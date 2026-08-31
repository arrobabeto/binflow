# Astro Orbitype tool implementation manual

How to implement and ship capabilities on stack `astro-orbitype` / profile
`astro_orbitype` without repeating the Bistro `create_blog_orbitype` failure
modes. Authoring skills: [create-tool](../../.cursor/skills/create-tool/SKILL.md),
[test-tool](../../.cursor/skills/test-tool/SKILL.md). Stack contract:
[astro-orbitype.md](../../.cursor/skills/create-tool/references/stacks/astro-orbitype.md).

Related: [ADR-0045](../adr/0045-astro-orbitype-enrollment.md),
[ADR-0047](../adr/0047-create-blog-orbitype-dual-write.md),
[ADR-0048](../adr/0048-enrolled-client-production-origin.md),
[ENROLLMENT.md](../ENROLLMENT.md), [create-blog-orbitype spec](../specs/create-blog-orbitype.md).

## 1. Stack contract

| Item | Requirement |
|------|-------------|
| Catalog stack | `astro-orbitype` |
| Project profile | `astro_orbitype` |
| Credentials | GitHub App (installation + repo), Vercel project, **Orbitype API** key |
| Enrollment | `productionDomain` (HTTPS public origin), locales, translation policy |
| Empty catalog at ACTIVE | Allowed (tools assigned later) |
| Publication | Dual-write GitHub markdown + Orbitype CMS when the tool declares it |
| Client-visible URLs | Frozen `deployment.productionOrigin` from enrollment (ADR-0048) — never Webbin defaults |
| Conversation vs content | `conversationLocale` = Telegram UI only; **all publishable prose** must be in enrolled `contentLocales` (fail closed if the model writes another language) |

Webbin (`astro_repo`) stays a separate pilot. Do not copy Webbin path, branch, or
URL constants into Orbitype tools. Client-specific prose lives only in
customization markdown.

## 2. Layer split

| Layer | Owns | Never |
|-------|------|-------|
| **code** | Ports, Zod, graph wiring, CMS column mapping, path matchers, origin resolution from manifest | Client domain strings, editorial voice, inventing CMS columns |
| **manifest** | `editablePaths`, collection dirs, `routePrefix`, `productionOrigin`, locales, bindings | LLM prompts, model/effort |
| **customization** | Voice, length, claims, optional `content_schema` | Paths, origins, permissions, skipping approvals |

Antipattern: hardcoding `https://webbin.com.mx` (or any one client) in shared
Telegram guidance, delete URL defaults, or Vercel production wait. Origins come
from the frozen manifest (worker → Vercel port). Webbin-only strings belong in
`astro_repo` builder / Webbin customization.

## 3. Required ports and worker wiring

1. **GitHub publication** — enrolled `expectedRepository` + default branch (not
   Webbin-only policy). Unit-test a non-Webbin draft.
2. **Vercel deployment** — pass `productionOrigin` from request-version manifest,
   then active enrollment `productionDomain`, then Webbin pilot **only** for
   `astro_repo` missing origin.
3. **Content language** — generate receives the frozen locale contract
   (`contentLocales`, `defaultContentLocale`, `translationPolicy`,
   `conversationLocale`). Publishable prose is asserted against enrolled
   content locales only; conversation Spanish must never become a DE-only
   article (`content_locale_mismatch` → one retry, then fail).
4. **Orbitype blog publication** — SQL must match the real CMS schema for the
   pilot (Bistro: `title` / `lead` / `status` / `sections` JSON). Schema/4xx →
   `provider_final`, not infinite BullMQ retries. Stable recovery outbox keys.
5. **Catalog** — declare `catalogScope` / `contentKinds` (ADR-0042); never widen
   shared factory defaults.
6. **Worker** — register `executorId` fail-closed; live execution flag explicit;
   one Telegram polling worker.

## 4. Manifest freeze checklist

Before first live tool run on an enrolled Orbitype client:

- [ ] `content.editablePaths` use `blog-{locale}/*.md` (direct files under the
      collection), plus image and CMS paths as needed.
- [ ] Collections set `routePrefix: /posts` (or the site’s real prefix).
- [ ] `deployment.productionOrigin` equals normalized enrollment
      `productionDomain` (no trailing slash).
- [ ] Rematerialize after any of the above changes; confirm version bump and
      bindings copied. Do not treat a rematerialize **noop** as success if the
      field is still missing.
- [ ] `matchesEditablePath` covers both `dir/*.md` and `dir/**/*.md` semantics.

Script pattern (Bistro):  
`pnpm --filter @binflow/tools exec tsx scripts/refresh-bistro-manifest-blog-paths.ts`

## 5. Create-blog graph expectations

Typical dual-write create graph (node ids must match `onStage`):

```text
catalog_sync → interpret_brief → … → generate → prepare_image → render_artifacts
  → create_github_draft → create_orbitype_draft → wait_preview
  → awaiting_client_approval → awaiting_admin_approval
  → merge_github → publish_orbitype → verify_production → completed
```

- Preview routes: `/posts/{draftId}/{titleSlug}` (CMS page shape), not Webbin
  `/{locale}/articulos/{slug}`.
- Title slug must match the site’s slugger (`postTitleSlug` / equivalent).
- Approvals bind to exact preview commit / deployment.
- `pull_requests` uniqueness is `(project_id, provider_id)` — PR numbers collide
  across repos.

## 6. Ops runbook (before inviting the client)

1. **One** worker with Telegram polling (`BINFLOW_LIVE_EXECUTION_ENABLED=true`).
   No Compose worker + host worker together.
2. Vercel: every Astro `PUBLIC_*` (at least `PUBLIC_SITE_URL`) enabled for
   **Preview** and Production.
3. Disable Preview Deployment Protection / SSO so `*.vercel.app` opens without
   Vercel login (Production may stay protected).
4. Smoke `/status` on the client bot; confirm not stuck send-only.
5. After first successful publish, assert Telegram production button host ==
   enrollment domain (not webbin.com.mx, not `*.vercel.app`).
6. Admin ready outbox drained; `FAILED_FINAL` notifies client and admin.

## 7. Failure-mode appendix

| Failure | Symptom | Prevention |
|---------|---------|------------|
| GitHub repo locked to Webbin | Draft/policy_denied | Enrolled repo/branch; non-Webbin unit test |
| Dual pollers / stale locks | Silent bot | One worker; dedicated Redis locks; promote send-only→polling |
| Path boundary | `render_artifacts` policy_denied | `blog-*/*.md` + matcher; rematerialize |
| Orbitype schema | Retry storm / invent columns | Real CMS columns; 4xx → provider_final |
| Preview env | BUILD_UTILS_SPAWN_1 / EnvInvalid | PUBLIC_* on Preview |
| Wrong preview routes | 404 on CTA | `/posts/{id}/{slug}` + routePrefix |
| Global PR provider_id | Stuck PREVIEW_DEPLOYING | Unique (project_id, provider_id) |
| Hardcoded production origin | webbin.com.mx links | ADR-0048 + worker pass-through |
| Preview SSO | Vercel login wall | Disable Preview protection |
| Stale manifest | Fixes don’t apply | Force rematerialize + verify fields |
| Notify gaps | Operator/client unaware | Ready outbox + FAILED_FINAL client notice |
| Hardcoded bilingual | Wrong translate/locales | Manifest locales only (ADR-0046) |

## 8. Do not break Webbin

Freeze unless a superseding ADR says otherwise:

- `astro_repo` manifest builder paths (`articulos` / `proyectos`),
  `bot/webbin/...`, bilingual defaults, pilot repo asserts.
- `webbinPilotBinding.productionOrigin` as **fallback only** when origin is
  missing on `astro_repo` / Webbin — never as the default for Orbitype.
- Webbin customizations under `packages/tools/stacks/astro-repo/**/customizations/`.
- Existing Webbin tools: `create_blog_draft`, `create_project_astro`,
  `delete_blog_draft`, `delete_project_astro` keep the same production host and
  route shapes when their frozen manifests say so.

Regression: Webbin fixtures must still expect `https://webbin.com.mx` and
`/articulos` / `/proyectos` routes.
