# Example — create_blog_wordpress customization

Placeholder for a client's editorial rules. Copy this file per client
(`<client>-create-blog-wordpress.md`), replace the bracketed guidance with the
client's real style rules, and upload it in Dashboard → Customizations →
`<client>` → `create_blog_wordpress`.

Editorial style only. It applies to the **Generate** mode, revisions and AI
cover images. It never changes the **As-is** mode (the client's text is
published word for word), models, REST routes, permissions, approvals or
locales (ADR-0067). The model writes limited Markdown (paragraphs, `##`/`###`
headings, lists, bold); rules asking for HTML, links, embeds or tables are
ignored.

## generate

[Voice and person — e.g. "second person, friendly, expert but plain".]

[Audience — who reads the blog and what they already know.]

[Structure — intro length, number of sections, heading style, closing
call to action.]

[Length — target words for a typical article.]

[Vocabulary — preferred terms, words to avoid, brand spelling.]

[Facts — never invent prices, dates, awards or claims not in the base
information.]

## prepare_image

[Cover mood — lighting, palette, subjects; no logos or text in the image.]

## apply_revision

[How to apply client feedback — e.g. "keep untouched paragraphs word for word;
only rewrite what the feedback names".]
