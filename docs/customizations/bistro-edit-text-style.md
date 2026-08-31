# Bistro — edit_text_style customization

Pilot hints for `edit_text_style@1` on Bistro (`astro_orbitype`).

## Layer

Customization only. Paths, permissions, and approval policy stay in code/manifest.

The `edit_text_style@1` graph has **no customizable node sections** yet
(`customizableNodeIds: []`), so there is nothing to upload via Dashboard or
script. Collection copy comes from code-owned ingress strings.

## Notes

- Style wraps the client excerpt in `<span data-binflow-style>` (words outside
  the excerpt stay unchanged). Bistro must allow those spans in `sanitize.ts`
  and render title/lead/**text** bodies via `CmsText` (including `SectionStory`).
- One `fieldKind` per request (`heading` | `subtitle` | `body`); mixed matches cancel.
- HEX color: at most two retries, then cancel.
- Enable on Bistro with migration `0030` plus
  `packages/tools/scripts/add-bistro-edit-text-style-binding.ts`.
