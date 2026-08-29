# Base vs customized audit mode

## `base`

Audits the **catalog tool** as shipped in `packages/tools/stacks/`.

| Judged | Sources |
|--------|---------|
| Graph, executor, ingress, CTAs, approvals | Code + brief + spec |
| Default collection asks | `customization-template.md` in stack folder |
| Manifest shape | Webbin reference manifest / spec examples |

Use when validating a new tool before any client upload, or regression after
platform changes.

## `customized`

Audits tool **plus active client customization**.

| Judged | Sources |
|--------|---------|
| Custom `content_schema` asks and closure | `docs/customizations/<client>-<tool>.md`, DB row |
| Editorial tone in asks | Customization markdown only |
| Graph, CTAs, paths, approvals | Still **code** — customization cannot change |

Required: `clientKey` (e.g. `webbin`).

## Assignment gate

Both modes assume the tool is **assigned** to the client project when running
`local-live`:

- `PUT /api/v1/admin/projects/:id/capabilities` (or dashboard equivalent)
- Project profile matches `migration.allowedProfiles`

Customization upload alone does not enable the tool.

## Scenario overlay

| Mode | Phase 2 overlays |
|------|------------------|
| `base` | A + B + C |
| `customized` | A + B + C + **D** (every `content_schema` field) |

## Fix routing

| Symptom | Likely layer |
|---------|--------------|
| Wrong CTA label on plan confirm | code (`*-ingress.ts`) |
| Wrong deletion paths | manifest (`editablePaths`) |
| Ask wording awkward | customization |
| Stuck `REVALIDATING` | code (runtime / GitHub / Vercel port) |
| Tool not offered in Telegram | manifest binding or assignment |

See [`layers.md`](../../create-tool/references/layers.md).
