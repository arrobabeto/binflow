# Live playbook (Phase 4 — `local-live`)

## Environment setup

1. Stack running: Postgres, Redis, API, worker, dashboard.
2. `BINFLOW_LIVE_EXECUTION_ENABLED=true` on worker for execute/publish jobs.
3. Client Telegram bot paired; admin bot for approval notifications.
4. Tool assigned to pilot project (Webbin): capability + version in dashboard.
5. If `customized`: customization uploaded and active (hash matches doc).

Record versions: tool catalog version, manifest version, customization version.

## Evidence to capture per scenario

| Artifact | Where |
|----------|-------|
| Bot message text | Telegram screenshot or copy-paste |
| Inline button **labels** | List labels only (not raw callback tokens in report) |
| Request id | Dashboard URL only in internal notes; use title in client copy examples |
| `request.state` | Dashboard request detail |
| Graph node | Dashboard tools graph or checkpoints |
| Admin notification | Admin Telegram or outbox (if applicable) |
| Production URL behavior | curl `-I` for 404 on deleted routes (destructive) |

## Execution order

1. Run **smoke** scenarios first (COM-01, COM-02, COM-05, one mutation scenario).
2. If smoke passes, run remaining **standard** matrix.
3. **Deep** only when user requested `depth=deep`.

Between destructive scenarios that mutate repo: prefer distinct articles or reset
only with operator approval.

## Telegram message recipes (Webbin ES)

### delete_blog_draft

| Scenario | Client sends |
|----------|--------------|
| COM-01 | `/delete_blog` |
| COM-02 | `borra el artículo https://www.webbin.com.mx/articulos/{slug}` |
| DEL-01 | Title only: `{exact catalog title}` |
| DEL-03 | Re-delete same article after completed delete |

Expected buttons at plan: `Borrar artículo` (not `Crear borrador`).

### create_blog_draft

| Scenario | Client sends |
|----------|--------------|
| COM-01 | `/create_blog` |
| CRE-01 | Topic sentence ≥ minimum length |

### create_project_astro

| Scenario | Client sends |
|----------|--------------|
| PRJ-01 | Natural language: "Nuevo proyecto para …" with stack/rol cues |
| PRJ-03 | Photo attachment on DM during `NEEDS_INPUT` |

## Admin path

When scenario requires admin approval:

1. Open dashboard `/requests/{id}`.
2. Verify PR head / file set matches terminal result.
3. Approve for publish.
4. Wait for worker publish job; confirm client notification.

For delete_blog: client should **not** receive PR URL buttons after PR opens.

## Production absence check (DEL-06)

After merge + verify:

```bash
curl -sI 'https://webbin.com.mx/articulos/{slug}' | head -5
curl -sI 'https://webbin.com.mx/es/articulos/{slug}' | head -5
```

Expect `404`. Post-deletion redirects are deferred until the client repo supports
Vercel-native routing (ADR-0041).

## Boundaries

- Do **not** modify `arrobabeto/webbin` unless user explicitly authorizes.
- Do **not** merge PRs manually unless ops runbook says so.
- Cancel stuck requests via dashboard when recovery doc says so.

## Offline substitute

When `environment=offline`:

1. Walk `packages/workflows/src/*-ingress.ts` for each scenario message.
2. Read `*-runtime.ts` for state transitions.
3. Grep ingress tests for button labels and error messages.
4. Mark all Phase 4 rows **unverified-live**.
