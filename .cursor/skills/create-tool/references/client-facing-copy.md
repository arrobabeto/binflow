# Client-facing copy rules

All Telegram messages, plan confirmations, inline buttons, and admin outbox
notices must read like product copy — not debug logs.

## Client messages (Telegram)

### Show

- Human **title** from catalog (fallback: title-case slug, never raw slug alone).
- **Public URL** when the action targets published content.
- Short **questions** from `content_schema` `ask` fields.
- Locale-appropriate verbs (`borrar`, `delete`, …).

### Never show

- Repository paths (`src/content/...`, `public/_redirects`).
- Commit SHAs, digests, deployment IDs, internal state names (`PREVIEW_DEPLOYING`).
- Raw UUIDs without context.
- File lists in plan confirm.

### Plan confirm (good vs bad)

**Good (delete blog, ES):**

```text
Plan: borrar el artículo **Mi Artículo**.
URL: https://webbin.com.mx/es/articulos/mi-articulo
```

Buttons: `Borrar artículo` | `Cancelar` — never `Crear borrador`.

**Bad:**

```text
Plan: borrar el artículo **mi-articulo**.
Archivos:
- src/content/articulos-es/mi-articulo.md
- public/images/articles/mi-articulo.avif
```

Buttons: `Crear borrador` (create-flow CTA reused on a destructive tool).

## Inline CTAs by decision surface

Telegram inline buttons are **not global**. Each capability defines labels per
**decision surface** (the moment the client chooses). The visible label must
describe what happens next — coherent with the tool, mutation class, and graph
node that will run — not with a shared create-blog default.

### Action token vs label

| Concern | What it is | Stability |
|---------|------------|-----------|
| **Action token** | Server binding (`confirm_plan`, `cancel`, …) | Stable across tools when the decision is the same |
| **Label** | Visible button text (`Borrar artículo`, `Crear borrador`, …) | **Per capability and surface** |

See [ADR-0026](../../../docs/adr/0026-telegram-inline-action-buttons.md). The
label is not tied to a graph `node.id`; it is tied to the **client decision**.
It must still sound like the next graph step (plan confirm on delete → queues
`open_deletion_pr`, not `create_draft`).

### Matrix (reference implementations)

| Surface | When | Typical actions | Labels (ES examples) |
|---------|------|-----------------|----------------------|
| Plan confirm | Input closed, before execute | `confirm_plan`, `cancel` | create: `Crear borrador`; delete: `Borrar artículo` |
| Target / URL confirm | Ambiguous target (title only) | `confirm_delete_target`, `cancel` | delete: `Sí, es este` |
| Preview ready | Worker after preview deploy | `approve_preview`, `request_revision`, `cancel` + URL buttons | create/update with preview |
| Admin pending (destructive) | After deletion PR opened | *(none — text only)* | delete: notify admin reviewing; no PR links, no Cancel |
| Revision plan | After client feedback | `confirm_revision_plan`, `adjust_revision_plan`, `cancel_revision` | update path |
| Cancel prompt | `/cancel` | `cancel` | `Cancelar` (shared OK) |

Canonical product copy: [`docs/TELEGRAM.md`](../../../docs/TELEGRAM.md) § Plan
and preview actions.

### Reference: delete_blog

| Surface | action | es | en | de |
|---------|--------|----|----|-----|
| Plan confirm | `confirm_plan` | Borrar artículo | Delete post | Beitrag löschen |
| URL confirm | `confirm_delete_target` | Sí, es este | Yes, this one | Ja, dieser |
| Admin pending | *(none)* | Text: admin reviewing deletion | Text only | Text only |
| (shared, pre-PR only) | `cancel` | Cancelar | Cancel | Abbrechen |

Implementation: `deleteBlogActionLabels` in
[`packages/workflows/src/delete-blog-ingress.ts`](../../../packages/workflows/src/delete-blog-ingress.ts).

### Reference: create_blog / create_project

| Surface | action | es | en | de |
|---------|--------|----|----|-----|
| Plan confirm | `confirm_plan` | Crear borrador | Create draft | Entwurf erstellen |
| (shared) | `cancel` | Cancelar | Cancel | Abbrechen |

Uses shared `localeCopy.confirm` in `packages/workflows/src/index.ts` — only
valid for **create** mutation class.

### Implementation pattern

1. Export `*ActionLabels` (or equivalent) in `packages/workflows/src/*-ingress.ts`
   next to `build*PlanMessage` / URL confirm builders.
2. Wire labels in `TelegramIngress` when calling `reply(..., actionTokens)` —
   never pass `localeCopy.confirm` for destructive or update-only tools.
3. Add ingress tests asserting labels do not contain create wording
   (`borrador`, `draft`, `entwurf`) when `mutationClass !== create`.
4. Document the full surface → action → label table in the capability spec.

### Never

- Reuse `localeCopy.confirm` / "Crear borrador" outside create tools.
- Show GitHub PR / preview URL buttons to clients during destructive admin review.
- Offer Cancel after a deletion PR is opened (admin owns approval; client cancel races merge).
- Use the same label on every tool "because it is plan confirm".
- Label a destructive confirm as if it creates a draft or opens a preview.

### Implementation targets

| Surface | Typical file |
|---------|--------------|
| Plan confirm + labels | `packages/workflows/src/*-ingress.ts` |
| Ingress wire-up | `packages/workflows/src/index.ts` (`reply` actionTokens) |
| Preview / revision buttons | `packages/messaging/src/index.ts` |
| URL confirm | same ingress module as plan |
| Collection asks | brief `contentSchemaFields[].ask` + customization |
| Stage notices | worker / runtime client notification helpers |

## Admin / outbox notices

### Minimum format

```text
Cliente: {tenantKey}
Acción: quiere borrar el artículo «{title}»
URL: {publicUrl}
PR: {pullRequestUrl}
Request: {requestId}
Dashboard: /requests/{requestId}
```

Adapt the action line per mutation class (create / update / delete).

### Never

```text
Admin approval required for blog deletion request 019abc...
```

UUID-only messages without client, action, or dashboard link.

### Implementation targets

| Surface | Typical file |
|---------|--------------|
| Admin approval required | `*-runtime.ts` (`enqueueAdminNotification`) |
| Client tool used | `packages/workflows/src/index.ts` |
| Published / completed | same runtime publish path |

## Locales

Provide `es`, `en`, and `de` copy for plan confirm, **inline CTAs**, and key
notices when the tool is Telegram-exposed. Keep structure parallel across locales.

## Checklist before ship

- [ ] Plan confirm has no repo paths.
- [ ] Every decision surface has action token + label documented in spec.
- [ ] Labels are capability-specific; destructive/update tools do not reuse create CTAs.
- [ ] Label describes the next client-visible outcome (matches graph intent).
- [ ] `*-ingress.test.ts` covers action labels for this tool.
- [ ] Admin notice includes client + natural action + request id + dashboard path.
- [ ] NL examples tested per locale (see ingress tests).
- [ ] Spec documents client-facing message shapes and inline CTA table.
