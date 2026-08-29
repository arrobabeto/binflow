# ADR-0037: Year-month fecha, URL evidence, AVIF covers, deterministic fact merge

- Status: Accepted
- Date: 2026-08-27
- Supersedes: None (amends [ADR-0034](0034-create-project-astro-reusable-tool.md),
  [ADR-0035](0035-project-content-schema-dsl-and-collection-loop.md), and
  [ADR-0036](0036-portfolio-hero-screenshot-cover.md))
- Superseded by: None

## Context

Early `create_project_astro` Webbin runs produced placeholder covers, invented or
empty Challenge/Solution/Outcome copy, poisoned string facts from Telegram
photo-only messages (`[image]`), and metadata that mixed confidentiality with
client-business type. Covers were JPEG while blog covers already use AVIF.
Project URLs were stored as visit-site links only; the live page was never read
as generation evidence. Most closed facts were left for the LLM to copy into
`project_bundle.v1` without a deterministic merge.

## Decision

1. **Base fact `projectDescription`.** Required natural-language description of
   the project / highlight (40–10_000 chars). Replaces base `description` as the
   reserved narrative fact id. Collection may still accept legacy `description`
   keys and alias them to `projectDescription`.
2. **Fecha is year-month.** Base `fecha` and DSL type `yearMonth` accept
   `YYYY-MM` only. Render and bundle persistence normalize to `YYYY-MM-01` for
   Astro `Date` frontmatter. Full-day `date` remains available for customization
   fields that need a day.
3. **Graph node `read_project_url`.** Graph
   `stacks/astro-repo/create-project@4` inserts
   `similarity → read_project_url → generate`. Deterministic HTTP GET (timeout,
   size cap, http/https only) strips scripts and truncates HTML text; an agent
   extracts typed `urlEvidence` used as generation grounding. No Playwright.
4. **AVIF covers.** Hero screenshots re-encode to AVIF (same quality band as
   blog covers). Public path `/images/projects/{slug}.avif`; manifest
   `editablePaths` allow `*.avif`. Missing provided cover bytes still fail with
   `cover_image_required`.
5. **Telegram photo integrity.** Slash-command handlers extract and persist
   inbound photos the same way as direct messages. Photo-only ingress must not
   invent `'[image]'` text that closes open string facts; image fields close only
   via artifact keys.
6. **Deterministic closedFacts merge.** After generate (and on structured
   inputs), code merges closed-fact metadata onto the bundle before validation:
   `clienteTipo`, `industria`, `impacto`, `stack`, `destacada`, `descriptor`
   seed, composed `rol` when role booleans are present, plus existing
   `confidencial` / `fecha` / `url` / `tipo` / `estado` merges. Narrative
   sections remain LLM-authored from `projectDescription` + `urlEvidence` +
   optional highlight.

## Consequences

- Operators must re-upload the Webbin customization after schema/ask changes.
- Existing JPEG portfolio assets in client repos remain valid; new Binflow
  drafts write AVIF. Manifests must allow the new extension.
- Fetch failures on `read_project_url` are best-effort: browser-like fetch plus
  title/OG meta extraction; when the page still cannot be read but
  `projectDescription` is present, generation continues without `urlEvidence`.
  Without description grounding, the request fails with a clear validation
  error rather than an infinite `provider_retryable` loop.
- ADR-0036 JPEG wording is amended for output format; the “client-provided
  screenshot, no AI cover” rule stands.

## Alternatives considered

- Keep day-precision fecha and only change the ask string: rejected; Webbin UI
  shows year and stores month-start dates.
- Playwright auto-screenshot of the URL for covers: deferred (rights/quality);
  clients still send `heroScreenshot`.
- Prompt-only mapping of closed facts: rejected after placeholder production
  copy; metadata must be force-merged in code.

## Verification

- Content-schema accepts `yearMonth` and scores `projectDescription` + `YYYY-MM`.
- Graph `@4` loads with `read_project_url` between similarity and generate.
- Slash-command + DM photos close image fields without poisoning `name` /
  string fields with `[image]`.
- Project executor writes `.avif` cover + `imagen` path; merge applies metadata
  from closed facts even when the model omits them.
- Fake URL fetch fixtures feed `urlEvidence` into generate without “Not
  specified” placeholders when facts are complete.
