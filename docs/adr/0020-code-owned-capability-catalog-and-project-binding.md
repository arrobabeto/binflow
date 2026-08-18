# ADR-0020: Code-owned capability catalog and project binding

- Status: Accepted
- Date: 2026-08-18

## Context

The first project manifest now freezes provider, locale, path and budget boundaries, but it intentionally contains no enabled capability. Activation needs an exact, auditable binding for `create_blog_draft` without allowing dashboard input or a model to invent an executor, schema, permission or approval policy.

## Decision

Binflow owns a global immutable capability registry in `@binflow/policies`. The first registry entry is `create_blog_draft@1`; its input/output schemas, executor, supported profile, risk, permissions, preview requirement, retry limits and budget ceiling are code-owned.

Enrollment validation materializes one immutable `project_capability_binding` for the validated manifest. The Webbin pilot may bind only `create_blog_draft@1` with `client_publish` access. The binding narrows the global definition and cannot replace schemas, executors, permissions or approval logic.

The manifest embeds the same binding and fingerprint. A capability-catalog validation attempt succeeds only when the database snapshot and manifest agree with the code-owned registry. `/tools`, natural-language routing and workflow creation read only the active manifest/binding; disabled or unknown definitions are invisible.

Existing-category publication requires client approval. A new category dynamically adds admin approval through deterministic policy code; it is not a broader binding.

## Consequences

- A model can select only an already-enabled capability and cannot activate one.
- Changing the capability definition requires a new immutable version and manifest revalidation.
- Capability activation is tenant/project/manifest scoped and auditable.
- The first manifest remains non-active until all later M07–M08 activation checks and pairing succeed.

## Rollback

Stop enrollment validation writers and restore the coordinated pre-release application/database backup when the release must be reverted. Do not delete historical binding or validation evidence.
