# Edit text style (Astro + Orbitype) — capability specification

Capability id: `edit_text_style@1`
Stack: `astro-orbitype`
Executor: `workflow.edit_text_style@1`
Command: `/edit_text_style`
Graph: `stacks/astro-orbitype/edit-text-style@1`
Mutation class: `update`

Canonical decision: [ADR-0053](../adr/0053-edit-text-style-orbitype.md).

---

## 1. Three layers

- **code** — Shared discovery helpers only; own executor/CTAs. One fieldKind per request; typed weight/size/color via **stepped interview** (one attribute per interaction; Done after ≥1); hex ≤2 retries then cancel; missing target copy with retry; style applied by wrapping `targetExcerpt` in a sanitized `<span style="…" data-binflow-style="1">` (words outside excerpt unchanged); Orbitype style preview + restore; client then admin approval.
- **manifest** — contentLocales; editablePaths for page copy files; deployment.productionOrigin; publicationTargets github+orbitype.
- **customization** — Optional editorial hints for collection prompts only. No paths, models, permissions, or approval overrides.

## 2. Content contract

Document manifest paths and bundle shape before implementation.

## 3. Capability inputs `[CODE]`

Define Zod input union modes in `packages/contracts/src/index.ts`.

## 4. Graph pipeline `[CODE]`

### Graph semantics

| node.id | nodeKind | kind |
|---------|----------|------|
| `sync_editable_copy` | `text.sync_editable_copy@1` | effect |
| `validate_text_style` | `text.validate_style@1` | compute |
| `render_style_patch` | `text.render_style_patch@1` | compute |
| `open_style_edit_pr` | `text.open_style_edit_pr@1` | effect |
| `wait_preview` | `deployment.wait_preview@1` | effect |
| `apply_orbitype_preview` | `text.apply_orbitype_style_preview@1` | effect |
| `awaiting_client_approval` | `workflow.awaiting_client_approval@1` | interrupt |
| `awaiting_admin_approval` | `workflow.awaiting_admin_approval@1` | interrupt |
| `merge_github` | `publication.merge_github@1` | effect |
| `publish_orbitype_pages` | `text.publish_orbitype_style_pages@1` | effect |
| `verify_production` | `text.verify_style_production@1` | effect |
| `completed` | `workflow.completed@1` | compute |

## 5. Client-facing messages

Ingress copy in `packages/workflows/src/edit-text-style-ingress.ts`. Target miss
uses a dedicated not-found retry message (request stays on `await_target`).
Style collection is a menu (Grosor / Tamaño / Color / Listo) then a single
attribute prompt — never all style buttons in one message. Plan confirm lists
human weight/size/color. CTAs: Aplicar estilo / Apply style — never Publish text.

## 6. Typed validation errors `[CODE]`

- `text_target_not_found` — Substring search finds no allowlisted string in the chosen locale.
- `text_target_ambiguous` — Substring matches more than one allowlisted field and client has not disambiguated.
- `text_field_denied` — Resolved path is H1, button, link, nav, or footer (denylist).
- `text_style_mixed_field_kinds` — Selection resolves to more than one field kind (e.g. section title and paragraph); request cancelled with non-technical client message.
- `text_locale_required` — Project is multilingual and locale was not closed in collection.
- `text_style_empty` — Client confirms plan with no style attributes closed.
- `text_style_color_invalid` — Hex invalid after two collection retries; request cancelled and client told to restart with a valid code.
- `text_target_stale` — Target field no longer matches at execute time.
- `orbitype_pages_patch_failed` — Orbitype rejects the pages sections style patch (4xx).
- `github_pr_failed` — Style edit PR cannot be opened or updated.
- `preview_not_ready` — Vercel preview does not become ready for the PR head.
- `production_style_mismatch` — Production page does not show the approved styles after publish.

## 7. Stack rollout

1. Run migration then `pnpm db:migrate` before dashboard assignment.
2. Add default binding to `astroRepoDefaultCapabilityBindings` when `allowedProfiles` includes `astro_repo`.
3. Rematerialize enrolled manifests after `editablePaths` changes.


## 8. Verification

- Existing tools (edit_text, create_*, delete_*, update_menu) unchanged in CTAs and dispatch.
- Monolingual skips locale; multilingual asks once.
- Mixed field kinds cancel with clear client message; no style patch applied.
- Weight/size/color interviewed one attribute per step; client may set one or
  more then Done (at least one required).
- Copy outside the excerpt is unchanged; style markup wraps only `targetExcerpt`.
- Invalid hex allows two retries with natural-language example; third failure cancels.
- Target not found: clear retry message; request stays open for another excerpt.
- Plan confirm and buttons say Apply style / Aplicar estilo — never Publish text or Create draft; plan body lists human weight/size/color (no JSON).
- Admin notice says change text style (not replace text / delete).
- Preview Orbitype style patch; cancel/reject restores snapshot; Approve or Cancel only.
- After client preview approval, admin approval required before merge.
- NL style phrases (de/es/en), including “edit text style” / “change text style”, dispatch to edit_text_style, not edit_text.
- verify_production confirms styled markup for the excerpt on production origin from enrollment.
