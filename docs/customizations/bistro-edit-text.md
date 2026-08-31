# Bistro — edit_text customization

Pilot hints for `edit_text@1` on Bistro (`astro_orbitype`).

## Layer

Customization only. Paths, permissions, and approval policy stay in code/manifest.

## Optional editorial hints

Use for collection prompts if needed; no model or path overrides.

```markdown
## collection_hints

- Prefer short excerpts from visible paragraphs when searching for text to edit.
- Do not offer button labels, navigation, or footer copy as edit targets.
```

Upload after assignment:

```bash
pnpm --filter @binflow/tools exec tsx scripts/upload-bistro-edit-text-customization.ts
```

(Script to be added when pilot copy is finalized.)
