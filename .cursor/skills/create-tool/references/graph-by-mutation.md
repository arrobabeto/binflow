# Graph coherence by mutation class

Graph node **ids** and **labels** must describe what happens when someone reads
the Tools dashboard graph. Do not reuse create-blog node names when the meaning
differs.

## Defaults by mutationClass

| mutationClass | Typical flow | `requiresPreview` | Vercel preview |
|---------------|--------------|-------------------|----------------|
| `create` | … → `create_draft` → `wait_preview` → client approval → merge → verify | `true` | Yes — preview of new content |
| `update` | … → revision nodes → PR or in-place apply → verify | case-by-case | Usually yes for PR-based updates |
| `destructive` | … → `open_deletion_pr` → admin approval → merge → verify redirects/absence | `false` | No — artefact = PR head |
| `read_only` | fetch / report nodes only | `false` | No |

## Node naming rules

1. **`node.id`** — snake_case, verb-led, mutation-specific (`open_deletion_pr`, not `create_draft`).
2. **`label`** — short dashboard label matching the id semantics.
3. **`nodeKind`** — domain prefix for tool-specific logic:
   - `blog.*`, `project.*` for domain stages.
   - `publication.*` only for shared GitHub ops (`merge`, shared draft creation for **create** flows).
   - `deployment.*` for Vercel wait/verify when preview is real.
4. **Never** reuse `create_draft` / `wait_preview` in destructive graphs.

## Reference: delete_blog (destructive)

```text
catalog_sync → resolve_target → validate_deletion → render_deletion_artifacts
  → open_deletion_pr → awaiting_admin_approval → merge_or_publish
  → verify_production → completed
```

- `open_deletion_pr` / `blog.open_deletion_pr@1` — GitHub PR removing files + redirects.
- `verify_production` / `deployment.verify_absence@1` — production 404 for deleted routes (redirects deferred per ADR-0041).

## Reference: create_blog (create)

```text
… → render_artifacts → create_draft → wait_preview → awaiting_client_approval → …
```

## Anti-pattern (do not ship)

`delete_project_astro` brief still listing `create_draft` → `wait_preview` for a
destructive tool. Fix before catalog registration.

## Review gate

Read the node list aloud: *"Then we **{label}**"* — if it sounds wrong for the
mutation, rename the id and nodeKind before implementation.

## onStage wiring

Executor `onStage('…')` strings **must equal** graph `node.id` values exactly.
