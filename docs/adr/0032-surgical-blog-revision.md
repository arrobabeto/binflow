# ADR-0032: Surgical blog revision with confirmed revision plan

- Status: Accepted
- Date: 2026-08-21
- Supersedes: None
- Superseded by: None

## Context

Post-preview "request changes" previously appended free-text feedback to
`interpretedInput.notes` and re-ran the full `create_blog_draft` executor from
catalog sync through image generation. A title-only edit therefore regenerated
body, image and preview. Clients need surgical edits with an explicit magnitude
and a confirmation step before work is applied.

## Decision

1. After revision feedback, an `interpret_revision` agent classifies a
   code-owned `RevisionMagnitude` and emits a structured `RevisionPlan` with a
   natural-language `summary` for the client.
2. The request enters `AWAITING_REVISION_PLAN_CONFIRMATION`. The client must
   confirm, adjust, or cancel before any mutation. Cancel returns to the prior
   preview approval gate without invalidating the previous preview binding.
3. Magnitudes are `title_locales`, `metadata`, `body_patch`, `image_only`, and
   `full_regenerate`. Surgical paths load the prior `GeneratedBlogBundle`
   artifact and apply only declared operations. Full regeneration uses the
   existing generate + image path.
4. The prior bilingual bundle is persisted as an artifact `kind: blog_bundle`
   per request version so surgical edits can round-trip exact content.
5. When the revision preserves slug/branch, GitHub draft update rewrites files
   on the existing branch/PR instead of returning stale PR evidence.
6. Publication approval still binds to the new preview head SHA and deployment
   (ADR-0006). Surgical revision never skips preview.

## Consequences

- Telegram UX gains confirm / adjust / cancel actions for revision plans.
- Free-text after `REVISION_REQUESTED` counts as feedback (not only `/revise`).
- Dashboard request detail must recognize the new state.
- Tests must prove title-only edits preserve body and image digests.

## Alternatives considered

- Always full regenerate with stronger prompts: rejected; still burns tokens and
  drifts unrelated content.
- Apply surgical edits without client confirmation: rejected; magnitude
  misclassification would mutate production-bound drafts silently.
- Diff UI in the dashboard: deferred; Telegram summary + stage log suffice.

## Verification

Title-attractiveness fixtures yield `title_locales` and unchanged body/image
digests after confirm. Thematic title changes propose `full_regenerate` and do
not apply until confirmed. Cancel restores `AWAITING_CLIENT_APPROVAL` on the
prior version's preview evidence.
