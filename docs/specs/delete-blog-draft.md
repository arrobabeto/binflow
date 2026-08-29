# Delete blog post — capability specification

Capability id: `delete_blog_draft@1`
Stack: `astro_repo`
Executor: `workflow.delete_blog@1`
Command: `/delete_blog`
Graph: `stacks/astro-repo/delete-blog@1`
Mutation class: `destructive`

---

## 1. Three layers

- **code** — Title/URL resolution, manifest path expansion, GitHub DELETE, catalog tombstone, production 404 verification.
- **manifest** — Blog collection directories and `editablePaths` determine files removed.
- **customization** — Optional ask wording for title/URL collection; cannot widen deletion scope.

## 2. Content contract

Document manifest paths and bundle shape before implementation.

## 3. Capability inputs `[CODE]`

Define Zod input union modes in `packages/contracts/src/index.ts`.

## 4. Graph pipeline `[CODE]`

- `catalog_sync` (effect)
- `resolve_target` (compute)
- `validate_deletion` (compute)
- `render_deletion_artifacts` (compute)
- `open_deletion_pr` (effect) — `blog.open_deletion_pr@1`
- `awaiting_admin_approval` (interrupt)
- `merge_or_publish` (effect)
- `verify_production` (effect) — `deployment.verify_absence@1` (404 after merge)
- `completed` (compute)

No Vercel preview deploy. Admin approval binds to the deletion PR head commit.
Merge revalidation checks PR head + file set only (does not wait for preview
commit status). Vercel may still build the PR branch for human review; Binflow
does not gate merge on that preview.

Post-deletion HTTP redirects are deferred per
[ADR-0041](../adr/0041-defer-delete-blog-redirects.md) until the client repo
supports a stack-native redirect mechanism.

## 5. Typed validation errors `[CODE]`

- `article_not_found` — Title or URL does not resolve to a **published** catalog item, or article files are already absent from the repository (already deleted).
- `ambiguous_title` — Multiple catalog matches for the same normalized title.
- `route_still_live` — Production verification finds a live article after merge.

## 6. Verification

- Collect title or URL; resolve to slug via **published** catalog only (`status = published`).
- Before resolving the target, ingress syncs the content catalog from GitHub (`main`)
  and persists it; existence checks use that fresh snapshot, not stale DB rows.
- Re-requesting delete for an already-removed article aborts early with
  `article_not_found` and client copy (no plan, no PR).
- Title-only input triggers URL confirmation before plan confirm
  (`Sí, es este` / `Yes, this one`, not create-draft CTAs).
- Plan confirm shows title + URL only (no repo paths); confirm button is
  `Borrar artículo` / `Delete post` / `Beitrag löschen` (`confirm_plan` →
  queue delete executor, not create draft).
- After `open_deletion_pr`, client receives **text-only** admin-pending notice
  (no GitHub PR links, no Cancel). Admin approves in dashboard only.
- On successful merge, client receives text-only deletion-complete notice.
- Deletion PR removes **existing** manifest-declared paths. Optional cover images
  absent from the repo are skipped.
- Admin-only approval required against PR head.
- Catalog item status becomes `deleted` after successful merge.
- Old article URLs return **404** in production after merge.
