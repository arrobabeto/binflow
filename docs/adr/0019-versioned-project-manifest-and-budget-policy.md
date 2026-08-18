# ADR-0019: Versioned project manifest and budget policy

- Status: Accepted
- Date: 2026-08-18
- Supersedes: None
- Superseded by: None

## Context

ADR-0005 requires a code-owned global profile and immutable project manifests,
while ADR-0017 makes manifest evidence a condition of enrollment activation.
The first implementation did not yet define when a manifest version is
materialized, how locale and budget settings are bound to it, or what an
administrator may edit without expanding the code-owned profile.

## Decision

- `@binflow/manifests` owns the versioned `astro_repo` global profile and the
  deterministic validator/builder. The profile is code, not administrator or
  model-generated JSON.
- A project manifest is materialized only by enrollment validation after the
  complete configuration and required provider bindings pass. Saving the wizard
  changes only the enrollment draft.
- Manifest versions are append-only positive integers per project. Revalidating
  an unchanged dependency fingerprint reuses the existing validated version;
  changing a dependency creates a new version and supersedes the prior
  non-active version atomically.
- Locale and budget policy snapshots are stored with the manifest version.
  They cannot be changed in place. The project points to an active version only
  after the full enrollment activation state machine succeeds.
- Budget values use integer counts and USD cents: requests per day, model calls
  per request, tokens per request, estimated cents per request and estimated
  cents per day. The daily cost ceiling cannot be lower than the per-request
  ceiling. Actual enforcement and usage aggregation are later workflow work,
  but no request may start without a frozen policy version once that workflow is
  enabled.
- The global `astro_repo` profile supports `en`, `es` and `de` as a maximum.
  The Webbin pilot overlay narrows this to Spanish source plus required Spanish
  and English output, a Spanish shared slug and `always_translate`. German and
  `ask_each_action` therefore fail Webbin manifest validation even though they
  remain valid global contract values for a future compatible project.
- The Webbin manifest binds only the verified `arrobabeto/webbin` repository,
  `main`, the two article collections, the article image directory and their
  exact path allowlist. Provider resource IDs come from current verified
  integration connections, never from freeform wizard input.
- Capability definitions and project capability bindings remain a separate
  code-owned boundary. This module exposes an empty binding snapshot until the
  capability-catalog module adds `create_blog_draft`; a model cannot populate it.

## Consequences

- Dashboard edits are safe drafts and cannot silently alter an active project.
- Validation evidence names the exact manifest version and fingerprint that was
  checked.
- Locale and budget changes make previous activation evidence stale through the
  enrollment dependency fingerprint.
- Adding another profile, path, locale overlay or budget dimension requires a
  documented global-contract change and tests before it becomes selectable.

## Verification

Tests cover global-profile narrowing, Webbin ES/EN invariants, blocked locales
and paths, integer budget limits, unchanged-version reuse, changed-version
supersession, tenant/project constraints, immutable snapshots, transactional
audit/outbox writes and fail-closed validation when a provider binding is absent.
