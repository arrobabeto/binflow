# ADR-0033: Create project draft portfolio capability

- Status: Accepted
- Date: 2026-08-21
- Supersedes: None
- Superseded by: [ADR-0034](0034-create-project-astro-reusable-tool.md)

## Context

Webbin publishes anonymized portfolio case studies as bilingual Astro content collections (`proyectos` / `proyectos-es`). Binflow already ships `create_blog_draft@1` for blog articles. Operators need a parallel capability with the same preview-first publication model but a distinct content contract, graph, and manifest paths.

## Decision

1. Add code-owned capability **`create_project_draft@1`** on stack `astro_repo` with executor `workflow.create_project@1` and Telegram command `/create_project`.
2. Intermediate artifact **`project_bundle`** (validated JSON) is the source of truth; Markdown files are rendered artifacts (same pattern as blog `blog_bundle` → MD).
3. Manifest **`content.portfolio`** block defines portfolio collection directories, editable paths, and image directory. Blog `content.collections` remains unchanged.
4. Graph omits blog-only nodes (`category_decision`, `awaiting_admin_approval`). Preview, client approval, surgical revision (ADR-0032), merge, and production verification match blog.
5. Client customization is style-only markdown per agent node; Webbin-specific voice lives in `customizations/webbin.md`, not in shared rules.
6. Capability registry and Webbin manifest bind both `create_blog_draft@1` and `create_project_draft@1`.

## Consequences

- Worker dispatches runtime by `requests.capabilityId`.
- GitHub catalog port gains portfolio tree sync for similarity checks.
- Dashboard Tools catalog lists two astro_repo capabilities.
- Tests cover tool load conformance, bundle validation, artifact render, and policy registry.

## Verification

- `@binflow/tools` loads both tools; stage lists match executors.
- `@binflow/projects` tests render EN/ES MD from bundle fixtures.
- `@binflow/policies` exposes both capabilities in catalog when bound.
- Docs: `docs/specs/create-project-draft.md`, `CONTRACTS.md`, `WORKFLOWS.md`.
