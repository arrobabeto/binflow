# ADR-0035: Project content-schema DSL and conversational collection loop

- Status: Accepted
- Date: 2026-08-27
- Supersedes: None (amends [ADR-0030](0030-declarative-tools-and-client-customization.md) and [ADR-0034](0034-create-project-astro-reusable-tool.md))
- Superseded by: None (base facts / fecha amended by [ADR-0037](0037-project-year-month-url-evidence-avif-cover.md))

## Context

`create_project_astro` accepted a single natural-language brief and jumped to plan
confirmation while the generator invented a Webbin-shaped `project_bundle.v1`.
That mixed client-specific case-study fields into code, blocked reuse for thinner
Astro portfolios, and skipped a ChatGPT-style loop that closes typed contracts
before narrative generation.

Operators already upload Markdown customizations, but ADR-0030 treated those
bodies as style-only and forbade schema influence. Teams need additional
**declarative** content fields per client without shipping TypeScript or free
Zod from Markdown.

## Decision

1. **Base closed facts `[CODE]`.** Every `create_project_astro` run collects a
   minimal fact set before generation: `name`, `fecha` (year-month),
   `projectDescription`, optional `category`, optional `images`. These ids are
   reserved; customization cannot redefine them. Legacy `description` aliases
   to `projectDescription` (ADR-0037).
2. **Allowlisted content-schema DSL `[CUSTOM]`.** Customization Markdown may
   include a `## content_schema` section with YAML `fields[]`. Allowed field
   types: `string`, `boolean`, `date`, `yearMonth`, `url`, `enum`, `stringList`,
   `image`. Bounds are capped in code. Unknown types, expressions, `$ref`, or
   JavaScript are rejected at upload. The compiler produces Zod used only for
   collection scoring; it cannot change models, paths, approvals, or bypass
   publication guards.
3. **Collection loop.** `/create_project` (or a natural portfolio brief) creates
   a request in `NEEDS_INPUT`. After each client message, code merges extracted
   candidates into closed facts and scores open required fields with Zod. The
   model may extract candidates and phrase one natural follow-up question using
   each field's `ask` (or a localized fallback); Zod alone decides when the set
   is closed. Closed facts transition the request to `AWAITING_PLAN_CONFIRMATION`.
4. **Generate from closed facts.** After plan confirm, generation treats closed
   facts as authoritative and produces the existing `project_bundle.v1` narrative
   envelope (localized case studies + sections). Long section prose is generated
   after collection, not gathered paragraph-by-paragraph unless a customization
   field requires it.
5. **Webbin.** Rich portfolio fields (descriptor, tipo, confidencial, stack,
   url conditions, etc.) live in the uploaded Webbin customization
   `content_schema` plus editorial sections—not hardcoded as Telegram input
   requirements in the tool base.
6. **Manifest remains structural.** Paths, `sectionHeadings`, `enumFields`, and
   `editablePaths` stay in the project manifest.

## Consequences

- ADR-0030 customization boundary expands from “style only” to “style plus
  allowlisted content fields”; security docs must treat YAML injection and
  oversized schemas as upload threats.
- Empty customization keeps the thin base collection path.
- Operators must upload Webbin's customization (including `content_schema`) for
  the rich pilot experience; dashboard Customizations remains the activation path.
- Tests cover DSL rejection, base collection without customization, and
  Webbin-merged schema collection.

## Alternatives considered

- Free Zod/TypeScript in Markdown: rejected (untrusted code execution).
- Putting all Webbin fields in the manifest: rejected (manifest owns structure,
  not conversational prompts / requiredWhen collection rules).
- Collecting full Reto/Solución/Resultado in chat: rejected for MVP; generate
  after facts close unless a DSL string field is explicitly required.

## Verification

- Upload rejects unknown field types and reserved base id collisions.
- Unit tests score open contracts for base-only and Webbin DSL fixtures.
- Workflow tests create `NEEDS_INPUT`, continue collection, then reach
  `AWAITING_PLAN_CONFIRMATION` when facts validate.
- Webbin customization document includes `## content_schema` and remains
  uploadable through `ToolCatalogService.uploadCustomization`.
