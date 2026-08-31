# ADR-0045: Astro+Orbitype profile enrollment and Orbitype API-key credential

- Status: Accepted
- Date: 2026-08-30
- Supersedes: None
- Superseded by: None
- Extends: [ADR-0014](0014-integration-credential-scope-and-verification.md),
  [ADR-0017](0017-resumable-enrollment-and-activation-evidence.md),
  [ADR-0030](0030-declarative-tools-and-client-customization.md)

## Context

The first MVP delivered managed onboarding only for `astro_repo` (Webbin pilot).
Roadmap Phase 6 calls for Orbitype profiles. Operators now need to enroll a
second technical profile — Astro sites whose content is managed through
Orbitype CMS — with the same dashboard + Telegram pairing model, before any
Orbitype-specific content tools exist.

SCOPE previously listed Orbitype as outside the first MVP. Expanding enrollment
to `astro_orbitype` is a deliberate post-MVP scope expansion, not a silent
reinterpretation of MVP acceptance.

## Decision

1. **Profile and stack.** Introduce project profile `astro_orbitype` and tool
   stack directory `astro-orbitype`. One tool per stack remains (ADR-0030). No
   multi-profile tools.
2. **Enrollment slice first.** An `astro_orbitype` enrollment may reach
   `ACTIVE` with Telegram client pairing **without** any capability bindings.
   Tools are added later via create-tool and assignment; empty catalog is valid.
3. **Required integrations for activation.** Same as `astro_repo` for GitHub
   App binding, Vercel project (may be a different Vercel account/team), OpenAI,
   and Telegram client bot, **plus** an Orbitype API-key credential that must
   pass read-only verification before activation/pairing gates that depend on
   integration readiness.
4. **Orbitype credential.** New provider kind (e.g. `orbitype-api`) with
   encrypted API key in the secret envelope and non-secret configuration
   (base URL / project identifiers as needed). Owner scope is **`project`**
   (same class as Vercel). Verification is read-only identity/auth against
   Orbitype; it must not create, update, or delete CMS content during
   enrollment. The LLM never receives the key or a generic Orbitype SQL tool.
5. **Freeze `astro_repo`.** Webbin and the four existing `astro-repo` tools
   remain unchanged. Shared ports must not gain wider defaults (ADR-0042).
6. **Admin bot.** Continues to be the single global platform admin Telegram bot.

## Consequences

- SCOPE, ONBOARDING, DASHBOARD, CONTRACTS, INTEGRATIONS, SECURITY, TESTING and
  ROADMAP must describe `astro_orbitype` enrollment as an accepted post-MVP
  profile.
- Contracts must extend `projectProfile` and credential kinds.
- First content tools for this stack are out of this ADR; they require
  create-tool + Orbitype content ports with allowlisted operations.

## Alternatives considered

- Reuse `astro_repo` with an Orbitype flag: rejected; ADR-0030 one profile per
  stack and distinct CMS contract.
- Defer Orbitype credential until first tool: rejected; operator requires
  end-to-end enrollment proof including CMS access from day one.
- Platform-scoped Orbitype key: rejected; CMS access is per client project.

## Verification

- Enrollment with profile `astro_orbitype` can validate and activate when
  GitHub, Vercel, OpenAI, Telegram client, and Orbitype API-key checks pass.
- Failed Orbitype auth leaves the previous credential version undisplaced
  (ADR-0014).
- Dashboard does not offer `astro_repo` tools for assignment to
  `astro_orbitype` projects (`allowedProfiles` / profile gate).
- Existing `astro_repo` enrollment and tools keep current acceptance tests.
