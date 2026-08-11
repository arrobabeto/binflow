# ADR-0005: Typed capabilities and manifests

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

Natural language cannot safely map to arbitrary filesystem/CMS mutations. Project contracts vary even within the same framework.

## Decision

User operations are versioned, typed capabilities with deterministic executors. A code-owned global profile manifest defines the maximum supported behavior; an immutable project manifest narrows and binds paths, fields, locales, rules, validation and approvals. LLM suggestions cannot create or enable executors.

## Consequences

- One global capability can serve multiple projects without hardcoding a project.
- Onboarding becomes a validation step rather than prompt editing.
- New behavior not represented by an executor is human development work.
- Manifest changes create new versions and do not affect active runs.

## Alternatives considered

- General repository agent: rejected for excessive privilege and unpredictable diffs.
- Project rules only in prompts: rejected because prompts are not authorization.
- Generated executors: rejected because generated code cannot self-authorize.

## Verification

Tests reject disabled capabilities, unknown bindings, blocked paths and manifest expansion beyond the global profile.
