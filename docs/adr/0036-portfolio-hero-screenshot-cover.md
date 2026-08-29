# ADR-0036: Portfolio cover from hero screenshot; required Webbin URL

- Status: Accepted
- Date: 2026-08-27
- Supersedes: None (amends [ADR-0034](0034-create-project-astro-reusable-tool.md) and [ADR-0035](0035-project-content-schema-dsl-and-collection-loop.md))
- Superseded by: None (output format amended by [ADR-0037](0037-project-year-month-url-evidence-avif-cover.md))

## Context

Webbin portfolio case studies expose a live-site button driven by frontmatter
`url`, and use a hero screenshot as the featured cover (`imagen`). The first
`create_project_astro` graph generated covers with `gpt-image-2` via
`prepare_image`, which produced synthetic images unlike production portfolio
entries. URL was only required when `publicationIntent: publish`, so drafts could
omit the live link clients expect on the site.

## Decision

1. **Remove AI cover generation from `create_project_astro`.** Graph
   `stacks/astro-repo/create-project@3` drops the `prepare_image` agent node.
   Covers are client-provided hero screenshots only (or omitted when the
   project's customization does not require one).
2. **Allowlisted DSL type `image`.** Customization `## content_schema` may
   declare `type: image` fields. Values are durable artifact storage keys
   collected during `NEEDS_INPUT` (Telegram photo → artifact store → closed
   fact). Zod treats a non-empty key as closed; bytes are never passed to the
   LLM.
3. **Webbin customization** requires:
   - `url` (`type: url`, `required: true`) — public product URL for the
     portfolio “visit site” control.
   - `heroScreenshot` (`type: image`, `required: true`) — hero capture used as
     featured cover under manifest `imageDirectory`.
4. **Executor:** default cover path is `provided`/`omit`. When
   `closedFacts.heroScreenshot` or `imageAssetId` is set, runtime loads artifact
   bytes and renders the cover (AVIF per ADR-0037); it never calls `generateImage`.
5. **Customization** may still include editorial notes about covers; it cannot
   restore AI image generation or widen writable paths.

## Consequences

- Blog `create_blog_draft` keeps its own `prepare_image` node unchanged.
- Surgical project revisions reuse the prior cover artifact; full regenerate
  still requires the collected hero screenshot (or prior cover) rather than a
  new model image.
- Operators must re-upload the Webbin customization document after this change.
- Telegram ingress accepts photo-only messages when an image attachment is
  present.

## Alternatives considered

- Keep `prepare_image` and only change Webbin prompts: rejected; production
  covers are screenshots, not generations.
- Auto-capture URL with Playwright in the tool: deferred; collection asks the
  client for an explicit hero capture for rights and quality control.

## Verification

- Tool catalog loads graph `@3` without `prepare_image`; stage list matches.
- Webbin customization upload requires `url` and `heroScreenshot`.
- Project executor with provided cover bytes writes `imagen` and cover file;
  without generate mode it does not call the image model.
- Content-schema rejects unknown image-adjacent types outside the allowlist.
