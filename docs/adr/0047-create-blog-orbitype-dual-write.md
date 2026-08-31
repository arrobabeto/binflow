# ADR-0047: Create blog for Astro+Orbitype with dual-write publication

- Status: Accepted
- Date: 2026-08-30
- Supersedes: None
- Superseded by: None
- Extends: [ADR-0030](0030-declarative-tools-and-client-customization.md),
  [ADR-0038](0038-capability-runtime-registry.md),
  [ADR-0042](0042-tool-isolation-and-shared-ports.md),
  [ADR-0045](0045-astro-orbitype-enrollment.md),
  [ADR-0046](0046-selectable-monolingual-locales.md),
  [ADR-0006](0006-preview-and-approval.md)

## Context

ADR-0045 delivered `astro_orbitype` enrollment with a project-scoped Orbitype
API key and zero required capabilities. Operators now need the first content
tool: create a blog article for pilots such as Bistro (monolingual `de`).

`create_blog_draft` remains frozen on `astro_repo` (GitHub markdown → PR →
Vercel). Reusing it across profiles would violate ADR-0030 (one tool per
stack). Orbitype CMS writes must be allowlisted ports — never a generic SQL
tool exposed to the LLM (ADR-0045).

The pilot requires **both** GitHub file publication (so Vercel git-integration
preview continues to work) **and** Orbitype CMS draft/publish, with independent
graph nodes so GitHub write can be disabled later via manifest targets.

## Decision

1. **New capability.** Register `create_blog_orbitype@1` on stack
   `astro-orbitype`, profile `astro_orbitype`, command `/create_blog`, executor
   `workflow.create_blog_orbitype@1`. Do not extend `create_blog_draft`.
2. **Dual-write nodes.** Publication uses separate effect nodes:
   `create_github_draft` → `create_orbitype_draft` → `wait_preview` (Vercel),
   and after approval `merge_github` → `publish_orbitype` → `verify_production`.
3. **Preview artefact.** Approval binds to the Vercel preview deployment and
   GitHub head commit (ADR-0006). Orbitype draft/version ids are recorded as
   auxiliary evidence.
4. **Locales from manifest.** Generation and preview CTAs use
   `contentLocales`, `translationPolicy`, `slugLocale`, and route prefixes from
   the active project manifest (ADR-0046). No locale is hardcoded in the tool.
5. **Publication targets.** Manifest field `content.publicationTargets`
   defaults to `['github', 'orbitype']` for this profile. Future skip predicates
   may omit GitHub nodes when `github` is absent; Bistro ships with both on.
6. **Orbitype ports.** `@binflow/orbitype` gains allowlisted draft create and
   publish operations using the project credential. The LLM never receives the
   API key or arbitrary SQL.
7. **Freeze `astro_repo`.** Shared GitHub catalog factories stay fail-closed
   and scoped (ADR-0042); do not widen defaults for this tool.

## Consequences

- SCOPE and ROADMAP Phase 6 treat Orbitype **content** create-blog as in scope
  for `astro_orbitype` pilots.
- Policies, migrations, ingress, and conformance register the new capability.
- Manifest builder for `astro_orbitype` must declare GitHub blog editable paths
  in addition to CMS collection paths so dual-write stays within path policy.
- Customization for Bistro is voice-only (`generate` / `prepare_image`).

## Alternatives considered

- Single `create_draft` node that writes both backends: rejected; prevents
  independent disable and obscures dashboard graph semantics.
- Orbitype-only write with non-git Vercel preview: rejected for the Bistro
  pilot; enrollment already uses `previewMode: git_integration`.
- Multi-profile `create_blog_draft`: rejected (ADR-0030 / ADR-0045).

## Verification

- Bistro (`astro_orbitype`, mono `de`) can run `/create_blog` end-to-end with
  dual-write and a Vercel preview.
- Assigning `create_blog_orbitype` to an `astro_repo` project is rejected.
- `create_blog_draft` acceptance tests remain green unchanged.
- Failed Orbitype draft after successful GitHub draft does not enter
  `wait_preview`.
