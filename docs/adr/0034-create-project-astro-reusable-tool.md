# ADR-0034: Reusable `create_project_astro` tool with manifest structure and uploaded customization

- Status: Accepted (amended 2026-08-27 by [ADR-0036](0036-portfolio-hero-screenshot-cover.md))
- Date: 2026-08-22
- Supersedes: [ADR-0033](0033-create-project-draft-portfolio-tool.md)
- Superseded by: None

## Context

The first portfolio capability (`create_project_draft@1`) coupled Webbin paths,
Spanish enums and H2 headings into shared renderer code and shipped Webbin
editorial voice in repository `customizations/webbin.md` with a runtime fallback.
That blocked reuse for other Astro clients (architecture firms, contractors) and
violated ADR-0030 separation between invariant code, manifest structure, and
untrusted client customization uploads.

## Decision

1. Rename the stack tool and capability to **`create_project_astro@1`**
   (`/create_project`, executor `workflow.create_project@1`, graph
   `stacks/astro-repo/create-project@3`). Cover images are client-provided hero
   screenshots when required by customization (ADR-0036); the tool does not
   generate covers with an image model.
2. **Tool base (code):** graph, executor, minimal closed-fact collection
   (`name`, `fecha`, `description`, optional `category`/`images`),
   `project_bundle.v1` narrative envelope after facts close, invariant shared
   rules, neutral `customization-template.md` (including `## content_schema`),
   validation nodes (`normalize_project_bundle`, `validate_project_bundle`,
   `validate_privacy_and_evidence`, `repo_contract_checks`).
3. **Structure (manifest):** per-project `content.portfolio` defines collection
   directories, route prefixes, editable paths, `sectionHeadings`, `enumFields`,
   and `requiredFrontmatter`. Renderer and validators read manifest values; no
   Webbin-specific strings in `@binflow/projects`.
4. **Style + content fields (customization):** operator-uploaded Markdown per
   project via dashboard (`project_tool_customizations`). May declare additional
   collectable fields via allowlisted `## content_schema` YAML (ADR-0035).
   **No** repository fallback for `create_project_astro` in
   `loadCustomizationSection`.
5. Webbin pilot binds `create_project_astro@1` with Webbin manifest paths and
   enums; rich case-study fields and editorial voice live in
   `docs/customizations/webbin-create-project-astro.md` for dashboard upload,
   not in the tool stack.
6. Keep `create_project_draft` in the capability id union and database for
   append-only history; new enrollments bind `create_project_astro@1`.

## Consequences

- Any Astro portfolio client shares the same tool; only manifest + uploaded
  customization differ.
- Operators must upload Webbin customization before full editorial quality;
  empty customization uses neutral template defaults.
- Tests cover Webbin manifest profile, minimal architect manifest smoke profile,
  and tool load without repo customization fallback.
- ADR-0033 remains historical; canonical spec moves to
  `docs/specs/create-project-astro.md`.

## Verification

- `@binflow/tools` loads `create_project_astro@1` graph `@2` with extended stage list.
- `@binflow/projects` renders headings from manifest fixtures.
- `@binflow/manifests` Webbin manifest includes `sectionHeadings` and `enumFields`.
- Migration `0020_create_project_astro_capability.sql` registers the capability.
- Docs: `docs/specs/create-project-astro.md`, `CONTRACTS.md`, `WORKFLOWS.md`,
  `CHANGELOG.md`.
