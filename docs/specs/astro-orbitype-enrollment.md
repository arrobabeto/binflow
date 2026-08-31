# Feature spec: Astro + Orbitype enrollment

- Slug: `astro-orbitype-enrollment`
- Status: Approved for implementation
- Primary type: `stack_profile`
- Secondary types: `integration`, `security_trust`, `dashboard`
- Date: 2026-08-30
- Owner: platform owner

## Problem

Binflow can only enroll `astro_repo` clients. Operators need to enroll Astro
projects that use **Orbitype** as CMS (GitHub repo + Vercel deploy + Orbitype
API), with client Telegram pairing, before any Orbitype content tools exist.

## Actor and outcome

- Actor: `platform_owner` (dashboard); client uses Telegram after pairing.
- Success criteria:
  - Select profile `astro_orbitype` in enrollment.
  - Register and verify GitHub, Vercel, OpenAI, Telegram client bot, and
    Orbitype API key (entered in the enrollment UI, encrypted at rest,
    read-only verify).
  - Complete pairing so the client Telegram bot is usable.
  - Reach `ACTIVE` **with zero capability bindings**.
- Freeze (must not change):
  - `astro_repo` / Webbin enrollment and the four tools
    (`create_blog_draft`, `create_project_astro`, `delete_blog_draft`,
    `delete_project_astro`).
  - Global admin Telegram bot topology.
  - ADR-0042 fail-closed shared port scopes.

## Behavior

### In scope

- Project profile `astro_orbitype` and catalog stack id `astro-orbitype`.
- Dashboard enrollment wizard support for the profile.
- Orbitype API-key credential kind + read-only verification + activation
  evidence.
- Manifest/global profile stubs sufficient for enrollment validation (structure
  may be minimal until first tool).
- Telegram client pairing identical in policy to `astro_repo`.

### Out of scope

- Any Telegram content tools for Orbitype (blog/portfolio create/delete).
- Writing CMS content, MCP SQL exposure to the LLM, or Orbitype webhooks (later).
- Changing `astro_repo` tools or Webbin bindings.
- Multi-project / multi-user enrollments.

### Failure modes

- Invalid Orbitype API key → candidate `invalid` or remains unverified; blocks
  activation checks that require Orbitype.
- Profile mismatch when assigning `astro_repo` tools →
  `capability_profile_incompatible`.
- Missing GitHub/Vercel/OpenAI/Telegram → same fail-closed activation as today.

### Acceptance criteria

1. Operator can create an enrollment with profile `astro_orbitype`.
2. Orbitype API key can be set, encrypted, and verified without CMS mutation.
3. After all required checks, pairing link works; client bot responds.
4. Enrollment can be `ACTIVE` with empty capability catalog.
5. `astro_repo` regression suite still passes unchanged.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 3 rule change (SCOPE/DASHBOARD expansion) | Approve | 2026-08-30 |

## Documentation impact assessment

Required by [`AGENTS.md`](../AGENTS.md):

- Canonical documents changed: SCOPE, ROADMAP, ONBOARDING, DASHBOARD,
  INTEGRATIONS, CONTRACTS, SECURITY, TESTING, ARCHITECTURE, GLOSSARY,
  CHANGELOG.
- ADRs added: [ADR-0045](../adr/0045-astro-orbitype-enrollment.md). Confirmed
  unchanged: ADR-0014, 0017, 0030, 0042 (extended, not superseded).
- Public contracts, schemas, states, permissions, operational steps, tests
  affected: `projectProfile` enum; credential kind; enrollment activation
  checks; dashboard profile selector; integration verify.
- Migration or rollback documentation affected: future DB/contract migration
  for profile + credential kind (implementation PR); rollback = disable
  profile selection and revoke Orbitype credentials.

## Compatibility

- Tools / executorIds / ports affected: **none** in this slice (0 tools).
- ADR-0042: do not widen GitHub catalog or other shared factories when
  implementing; Orbitype is a new port/credential.
- Impact Report: conversation Phase 2 (`astro-orbitype-enrollment`).

## Handoff

- Next: **Agent implementation plan** (enrollment only). First tools later via
  [`create-tool`](../../.cursor/skills/create-tool/SKILL.md).

Ordered tasks after this spec:

1. Contracts: add `astro_orbitype` to `projectProfileSchema`; Orbitype
   credential kind + verify evidence shape.
2. Secrets/integrations: Orbitype verifier (read-only); wire into enrollment
   activation checklist.
3. Manifests: minimal global/project profile for `astro_orbitype`.
4. Dashboard/API: profile selectable; credential form; hide incompatible tools.
5. Tests: unit/contract for verify; enrollment activation; `astro_repo`
   regression.
6. Later: create-tool for first Orbitype content capability.

## References

- ADR: [0045](../adr/0045-astro-orbitype-enrollment.md)
- Roadmap Phase 6: [ROADMAP.md](../ROADMAP.md)
- Related: [ONBOARDING.md](../ONBOARDING.md), [INTEGRATIONS.md](../INTEGRATIONS.md)
