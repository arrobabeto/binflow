# Delete portfolio project — capability specification

Capability id: `delete_project_astro@2`
Stack: `astro-repo` (project profile: `astro_repo`)
Executor: `workflow.delete_project@1`
Command: `/delete_project`
Graph: `stacks/astro-repo/delete-project@1`
Mutation class: `destructive`

Canonical decision: [ADR-0040](../adr/0040-destructive-content-capabilities.md).

**Status:** Accepted — shipped with `delete_project_astro@2` (migration `0023`).

---

## 1. Three layers

- **code** — Title/URL resolution, manifest portfolio path expansion, GitHub DELETE,
  catalog tombstone, production 404 verification.
- **manifest** — Portfolio collection directories, cover paths (`.avif` / `.jpg`), and
  `portfolio.editablePaths` determine files removed.
- **customization** — Optional ask wording for title/URL collection; cannot widen
  deletion scope or skip admin approval.

## 2. Content contract

Deletion removes manifest-declared portfolio paths:

- `{portfolio.collections[locale].directory}/{slug}.md` for each configured locale
- `{portfolio.imageDirectory}/{slug}.avif` and/or `.jpg` when allowed by editable paths

No LLM in the flow. No Vercel preview deploy.

## 3. Capability inputs `[CODE]`

```ts
type DeleteProjectAstroInput =
  | {
      mode: 'collect';
      projectId: string;
      closedFacts: Record<string, unknown>;
      messages: string[];
      collectionComplete?: boolean;
      resolvedSlug?: string;
      resolvedUrl?: string;
      targetConfirmed?: boolean;
    }
  | {
      mode: 'execute';
      projectId: string;
      resolvedSlug: string;
      resolvedTitle?: string;
      resolvedUrl?: string;
      targetTitle?: string;
      targetUrl?: string;
    };
```

Collect modes accept `targetTitle` or `targetUrl`. Title-only input requires URL
confirmation before plan confirm.

## 4. Graph pipeline `[CODE]`

- `catalog_sync` (effect)
- `resolve_target` (compute)
- `validate_deletion` (compute)
- `render_deletion_artifacts` (compute)
- `open_deletion_pr` (effect) — `project.open_deletion_pr@1`
- `awaiting_admin_approval` (interrupt)
- `merge_or_publish` (effect)
- `verify_production` (effect) — `deployment.verify_absence@1` (404 after merge)
- `completed` (compute)

Admin approval binds to the deletion PR head commit. Merge revalidation skips
preview commit-status gate (same as delete blog).

## 5. Typed validation errors `[CODE]`

| Code | When |
|------|------|
| `project_not_found` | Title/URL does not resolve to a published catalog item, or project files are absent from the repo |
| `ambiguous_title` | Multiple catalog matches for the same normalized title |
| `route_still_live` | Production verification finds a live route after merge (retryable) |

## 6. Verification

- `/delete_project` command and natural language (`borra/elimina/delete` + portfolio cues)
  when capability is assigned.
- NL dispatch registers **before** create-project NL so destructive verbs win.
- Ingress syncs portfolio catalog from GitHub before target resolution.
- Plan confirm shows title + URL only; CTAs: `Borrar proyecto` / `Delete project`.
- Admin-only approval (`webbin-project-deletion@1`).
- Catalog item status becomes `deleted` after successful merge.
- Production portfolio routes return **404** after merge (polling verification).

See `docs/TESTING.md` scenario matrix DEL-PROJECT-*.
