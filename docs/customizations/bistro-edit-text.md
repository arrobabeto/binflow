# Bistro — edit_text customization

Pilot hints for `edit_text@1` on Bistro (`astro_orbitype`).

## Layer

Customization only. Paths, permissions, and approval policy stay in code/manifest.

The `edit_text@1` graph has **no customizable node sections** yet (`customizableNodeIds: []`), so there is nothing to upload via Dashboard or script. Collection copy comes from code-owned ingress strings.

When a customizable section is added to the tool graph, document it here and use:

```bash
pnpm --filter @binflow/tools exec tsx scripts/upload-bistro-edit-text-customization.ts
```
