# Edit site image (Astro + Orbitype) — capability specification

Capability id: `edit_image@1`
Stack: `astro-orbitype`
Executor: `workflow.edit_image@1`
Command: `/edit_image`
Graph: `stacks/astro-orbitype/edit-image@1`
Mutation class: `update`

---

## 1. Three layers

- **code** — Allowlisted images on pages (non-page-hero) and blogs including cover/hero. Deny page SectionHero and nav/footer logos. Keys page:{slug}:{i}:{field} and blog:{postId}:{i}:{field}. Multilingual: no locale pick; one asset patches all contentLocales. Deterministic discovery; confirm_target sends current photo + URL; replacement via attachment or URL. Preview: GitHub PR → Vercel wait → temporary Orbitype patch using absolute preview asset URL (snapshot first). Cancel/reject restore. Post-merge publish uses relative path. Preview approve/cancel; admin gets preview link.
- **manifest** — contentLocales for all-locale fan-out; editablePaths; productionOrigin; publicationTargets github+orbitype.
- **customization** — Optional collection hints only. No paths, models, or approval overrides.

## 2. Content contract

Allowlisted image fields on Orbitype `pages.sections` and `posts` (`img` cover +
section image fields). Keys: `page:{slug}:{sectionIndex}:{field}` and
`blog:{postId}:{sectionIndex}:{field}` (`sectionIndex` `-1` for blog cover).
GitHub dual-write: binary under the manifest `imageDirectory` (Orbitype default
`public/images/blog/edit-{id}.{avif|jpg|png|webp}`) plus CMS mirrors under
`cms/collections/**`, both constrained by `editablePaths`. Do not invent paths
outside the allowlist (e.g. `public/images/edits/**` is not enrolled).

Pilot rematerialize (Bistro): `packages/tools/scripts/add-bistro-edit-image-binding.ts`.

## 3. Capability inputs `[CODE]`

`editImageInputSchema` in `packages/contracts/src/index.ts` (`collect` | `execute`).
Collect steps: `await_target` → `disambiguate` → `confirm_target` →
`await_replacement` → `ready` (no locale step).

## 4. Graph pipeline `[CODE]`

### Graph semantics

| node.id | nodeKind | kind |
|---------|----------|------|
| `sync_editable_images` | `images.sync_editable_images@1` | effect |
| `validate_image_edit` | `images.validate_edit@1` | compute |
| `render_image_patch` | `images.render_patch@1` | compute |
| `open_image_edit_pr` | `images.open_edit_pr@1` | effect |
| `wait_preview` | `deployment.wait_preview@1` | effect |
| `apply_orbitype_preview` | `images.apply_orbitype_preview@1` | effect |
| `awaiting_client_approval` | `workflow.awaiting_client_approval@1` | interrupt |
| `awaiting_admin_approval` | `workflow.awaiting_admin_approval@1` | interrupt |
| `merge_github` | `publication.merge_github@1` | effect |
| `publish_orbitype_content` | `images.publish_orbitype_content@1` | effect |
| `verify_production` | `images.verify_production@1` | effect |
| `completed` | `workflow.completed@1` | compute |

After `wait_preview`, `apply_orbitype_preview` snapshots the live row and
patches Orbitype with an **absolute Vercel preview URL** for the new asset so
CMS-backed sites show the change without live 404s on PR-only relative paths.
Client cancel / admin reject enqueue `restore_orbitype_preview`. After merge,
`publish_orbitype_content` rewrites CMS to the relative production path.

## 5. Client-facing messages

Ingress copy in `packages/workflows/src/edit-image-ingress.ts`. Confirm target
includes optional `TelegramReply.photoUrl` and the absolute image URL in the
message body so the client can open and verify the asset. Plan confirm notes
all-locale update when `contentLocales.length > 1`. CTAs: Confirm image / Not
this one / Publish image / Select / Approve / Cancel — never create-draft wording.

## 6. Typed validation errors `[CODE]`

- `image_target_not_found` — Search finds no allowlisted image for the query.
- `image_target_ambiguous` — Query matches more than one allowlisted slot.
- `image_field_denied` — Resolved slot is page hero, nav/footer logo, or other denylist match.
- `image_replacement_missing` — Client confirms plan without a replacement attachment or URL.
- `image_replacement_invalid` — Replacement URL or attachment fails MIME, size, or fetch validation.
- `image_target_stale` — Current public path no longer matches at execute time.
- `orbitype_content_patch_failed` — Orbitype rejects the pages or posts patch (4xx).
- `github_pr_failed` — Image edit PR cannot be opened or updated.
- `preview_not_ready` — Vercel preview does not become ready for the PR head.
- `production_image_mismatch` — Production does not serve the approved new image after publish.

## 7. Stack rollout

1. Run migration then `pnpm db:migrate` before dashboard assignment.
2. Add default binding to `astroRepoDefaultCapabilityBindings` when `allowedProfiles` includes `astro_repo`.
3. Rematerialize enrolled manifests after `editablePaths` changes.


## 8. Verification

- Multilingual project skips locale question; execute patches all contentLocales for the slot.
- Denylist blocks page heroes and nav/footer logos; blog cover/hero remains editable.
- Ambiguous query returns numbered disambiguation, not auto-pick.
- confirm_target posts current image photo, includes the absolute image URL in
  the confirm text for visual verification, plus Confirm / Not this one / Cancel
  before replacement.
- Not this one returns to target search without closing the request.
- Plan confirm states all-locale update when contentLocales.length > 1.
- Replacement accepts Telegram photo or HTTPS URL; one image per request.
- Preview temporarily patches Orbitype with the absolute preview asset URL so
  CMS-backed sites show the change; client Approve or Cancel only. Cancel /
  admin reject restore the snapshot. After merge, publish uses the relative path.
- Admin admin_approval_required card includes Vercel preview URL button.
- After client preview approval, admin approval is required before merge.
- NL ingress de/es/en edit-image phrases dispatch to edit_image.
- verify_production polls until new image URL is visible on production.
