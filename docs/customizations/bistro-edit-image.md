# Bistro — edit_image customization

Pilot hints for `edit_image@1` on Bistro (`astro_orbitype`).

## Layer

Customization only. Paths, permissions, and approval policy stay in code/manifest.

The `edit_image@1` graph has **no customizable node sections** yet (`customizableNodeIds: []`), so there is nothing to upload via Dashboard or script. Collection copy comes from code-owned ingress strings.

## Notes

- Multilingual Bistro: one replacement updates every `contentLocales` slot (no locale pick).
- Page heroes and logo fields remain denied; blog cover/hero remain editable.
- Confirm target posts the current production image URL as a Telegram photo when resolvable.
