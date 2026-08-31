# ADR-0053: Edit text style for Astro + Orbitype

- Status: Proposed
- Date: 2026-08-31
- Supersedes: None
- Superseded by: None
- Extends: [0051](0051-edit-text-orbitype.md) (targeting / denylist; not copy replacement)

## Context

`astro_orbitype` clients need to change **size, weight, and/or color** of
allowlisted page copy without rewriting the string. Non-technical users cannot
use raw CSS (px, weight numbers, hex) as the primary UX. Existing `edit_text`
already solves targeting (substring, denylist, locale, disambiguation) but must
not share CTAs, messages, or style mutation semantics.

A single request may adjust multiple style attributes. A hard guardrail forbids
mixing field kinds in one edit (e.g. subtitle + body). Invalid hex must retry
twice with plain-language examples, then cancel the request.

Existing capabilities (`edit_text`, `edit_image`, blog, delete, menu) must keep
their graphs, labels, and dispatch behavior unchanged (**ADR-0042** isolation).

## Decision

1. Register `edit_text_style@1` on stack `astro-orbitype` / profile
   `astro_orbitype` with executor `workflow.edit_text_style@1`.
2. Mutation class `update`; `requiresPreview: true`; client then admin approval
   (policy `astro-orbitype-text-style-edit@1`).
3. Collection: target like `edit_text` → confirm → **interview** for style
   attributes one step at a time (choose weight **or** size **or** color, then
   set that attribute, return to the menu). Client may change one, some, or all
   attributes; **Done** requires ≥1. Hex: up to two retries, then `CANCELLED`.
   Missing target substring returns a clear retry message (request stays open).
4. Guardrail `text_style_mixed_field_kinds`: cancel with non-technical copy when
   selection spans more than one field kind.
5. Graph uses style-specific node ids/kinds (`validate_text_style`,
   `render_style_patch`, `open_style_edit_pr`, style preview/publish/verify);
   may reuse shared discovery helpers and shared `wait_preview` /
   `merge_github` / approval interrupts only.
6. Own Telegram/admin copy and CTAs (e.g. **Aplicar estilo** / **Apply style**);
   never reuse `edit_text` “Publish text” or create/delete labels.
7. Style is applied **surgically** by wrapping the client’s `targetExcerpt`
   (first normalized match inside the field) in a
   `<span style="…" data-binflow-style="1">…</span>` with only the chosen
   weight / size / color. Astro sites must allow that span through HTML
   sanitize and render allowlisted fields via sanitized HTML (not escaped
   text nodes). Sibling `${field}Style` objects are not the publication
   contract for visibility.

## Consequences

- New catalog row, migration, runtime registration, and Bistro binding after
  migrate.
- ADR-0051 remains the copy-replacement tool; this ADR is style-only but may
  insert style markup around the excerpt (words outside the excerpt stay
  unchanged).
- Pilot sites (Bistro) must allow `span` + safe `font-weight` / `font-size` /
  `color` styles and render editable fields (including `text` bodies such as
  `SectionStory`) with sanitized HTML (`CmsText` / `SafeHtml`), not escaped
  text nodes.
- Cancel / admin reject restore must not silently no-op when the style patch
  artifact is missing; mark restore failure on the request.
- Security/ops: same preview restore and approval binding as text edit.

## Alternatives considered

- Extend `edit_text` with style modes: rejected — would couple CTAs and
  confuse NL dispatch.
- Freeform CSS from the client: rejected — not usable for non-technical users.
- Sibling `${field}Style` only (no markup): rejected for Bistro — the site
  never read those keys, so published weight/size/color were invisible.

## Verification

- Regression: existing tools’ CTAs and dispatch unchanged.
- Mixed field kinds cancel; hex retry then cancel; multi-attribute plan.
- NL style phrases route to `edit_text_style`, not `edit_text` (including English
  “edit text style” / “change text style”).
- verify_production asserts styled markup (or style attributes) for the
  excerpt, not only plain text presence.
