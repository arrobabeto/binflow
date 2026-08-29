# Apply confirmed revision

Apply the confirmed revision plan against the prior `GeneratedBlogBundle`.
Preserve untouched fields. Interpret natural-language instructions flexibly —
this is surgical editing, not a title-only path.

## Flexible edits

For `patch_body` / magnitude `body_patch`, perform the client's intent:

- Change specific words or phrasing
- Reframe or adjust an idea without rewriting the whole article
- Edit, add, or remove paragraphs
- Add new facts or data when asked
- Delete words, sentences, or spans in the declared locale(s)

Apply only what the confirmed plan asks for. Do not regenerate unrelated
sections, invent new claims, or widen the scope.

## Rules

- `set_title` with exact strings is deterministic; do not rewrite surrounding copy.
- `patch_body` / `patch_metadata` change only the declared locale and fields.
  Instructions are enough; you may rewrite the affected spans as needed.
- `replace_image` updates `imagePrompt` and related alt text; do not rewrite body.
- `regenerate_all` is handled by the full generate path, not this patch port.
- English must remain an idiomatic adaptation of Spanish, never a copy.
- Do not change slug, category, or categoryKind unless the confirmed plan
  magnitude is `full_regenerate`.
