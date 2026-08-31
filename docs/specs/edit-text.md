# Edit page text (Astro + Orbitype) — capability specification

Capability id: `edit_text@1`
Stack: `astro-orbitype`
Executor: `workflow.edit_text@1`
Command: `/edit_text`
Graph: `stacks/astro-orbitype/edit-text@1`
Mutation class: `update`

---

## 1. Three layers

- **code** — Allowlisted editable copy paths (paragraphs and non-H1 section titles only). Denylist H1, button labels, link text, nav, and footer menus. Exact substring match corpus from Orbitype pages plus GitHub mirror paths. One replacement per request per locale. Literal oldValue→newValue **whole-field** patch with no LLM mutation (substring only locates the field). Collection: optional locale pick, target disambiguation, confirm_target, await_replacement, plan confirm. Preview: GitHub PR → Vercel wait → temporary Orbitype pages patch (snapshot first). Preview approve/cancel only (no revision). Cancel/admin reject restore snapshot via `restore_orbitype_preview`. Admin approval before merge; `publish_orbitype_pages` re-applies after merge.
- **manifest** — contentLocales for locale gate and corpus labels; editablePaths for GitHub page copy files; deployment.productionOrigin; publicationTargets github+orbitype.
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
| `validate_text_edit` | `text.validate_edit@1` | compute |
| `render_text_patch` | `text.render_patch@1` | compute |
| `open_text_edit_pr` | `text.open_edit_pr@1` | effect |
| `wait_preview` | `deployment.wait_preview@1` | effect |
| `apply_orbitype_preview` | `text.apply_orbitype_preview@1` | effect |
| `awaiting_client_approval` | `workflow.awaiting_client_approval@1` | interrupt |
| `awaiting_admin_approval` | `workflow.awaiting_admin_approval@1` | interrupt |
| `merge_github` | `publication.merge_github@1` | effect |
| `publish_orbitype_pages` | `text.publish_orbitype_pages@1` | effect |
| `verify_production` | `text.verify_production@1` | effect |
| `completed` | `workflow.completed@1` | compute |

## 5. Client-facing messages

Document plan confirm and admin notice shapes per `client-facing-copy.md`.

## 6. Typed validation errors `[CODE]`

- `text_target_not_found` — Substring search finds no allowlisted string in the chosen locale.
- `text_target_ambiguous` — Substring matches more than one allowlisted field.
- `text_field_denied` — Resolved path is H1, button, link, nav, or footer (denylist).
- `text_locale_required` — Project is multilingual and locale was not closed in collection.
- `text_replacement_empty` — Client confirms plan with empty new text.
- `text_target_stale` — oldValue no longer matches at execute time.
- `orbitype_pages_patch_failed` — Orbitype rejects the pages sections patch (4xx).
- `github_pr_failed` — Text edit PR cannot be opened or updated.
- `preview_not_ready` — Vercel preview does not become ready for the PR head.
- `production_text_mismatch` — Production page does not show the approved new text after publish.

## 7. Stack rollout

1. Run migration then `pnpm db:migrate` before dashboard assignment.
2. Add default binding to `astroRepoDefaultCapabilityBindings` when `allowedProfiles` includes `astro_repo`.
3. Rematerialize enrolled manifests after `editablePaths` changes.


## 8. Verification

- Monolingual project skips locale question; multilingual asks once.
- Denylist blocks H1, buttons, links, nav, and footer from discovery.
- Ambiguous substring returns numbered disambiguation, not auto-pick.
- confirm_target then plan confirm show exact old and new field strings only.
- Execute performs literal whole-field replacement without LLM paraphrase.
- Preview temporarily patches Orbitype so CMS-backed sites show the new copy;
  client Approve or Cancel only. Cancel / admin reject restore the snapshot.
- After client preview approval, admin approval is required before merge;
  `publish_orbitype_pages` runs after merge.
- One field replacement per request; second change needs a new request.
- NL ingress de/es/en edit-text phrases dispatch to edit_text.
- verify_production polls until new text is visible on production.
