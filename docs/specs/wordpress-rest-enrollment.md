# Feature spec: WordPress REST enrollment

- Slug: `wordpress-rest-enrollment`
- Status: Approved for implementation
- Primary type: `stack_profile`
- Secondary types: `integration`, `dashboard`, `security_trust`
- Date: 2026-10-13
- Owner: platform

## Problem

Every enrollable profile (`astro_repo`, `astro_orbitype`, `shopify_liquid`)
depends on a GitHub App binding. Classic WordPress sites have no repository;
everything is operated through the WordPress REST API. Operators need to enroll
WordPress clients, verify API access and pair the client Telegram bot before
any WordPress tool exists.

## Actor and outcome

- Actor: `platform_owner` (dashboard); client uses Telegram after pairing.
- Success criteria:
  - Select profile `wordpress_rest` in **Clients → New**.
  - Register and verify `wordpress-api` (Application Password), OpenAI and the
    Telegram client bot; require `productionDomain`.
  - Validate runs a **read probe** (posts + categories) and the dashboard shows
    its summary.
  - Reach `ACTIVE` with **zero** capability bindings; `/help` and Hey Binn
    reply on the client bot.
- Freeze (must not change):
  - `astro_repo` / Webbin, `astro_orbitype`, `shopify_liquid` enrollment,
    tools, executors and shared-port defaults.
  - Global admin Telegram topology (ADR-0007).
  - ADR-0042 fail-closed shared port scopes.

## Identity

- Stack id (hyphen): `wordpress-rest`
- Project profile (underscore): `wordpress_rest` (already reserved in
  `projectProfileSchema`)
- Selectable enrollment: **yes** (after implementation)
- Pilot: none yet (defined before ENROLLMENT.md section B)

## Behavior

### In scope

- Add `wordpress_rest` to `selectableEnrollmentProfileSchema`.
- New integration kind `wordpress-api` (project scope) with a read-only
  verifier.
- Manifest shape for `wordpress_rest`: no `repository`, no `deployment`;
  `content.source: 'wordpress'`; `wordpress` block (site origin, REST base,
  username, verified user id, role).
- Activation checks: `configuration`, `openai_credential`,
  `telegram_admin_credential`, `telegram_client_credential`,
  `wordpress_api_credential`, `wordpress_read_probe`,
  `production_domain_matches_site_url`.
- Empty capability catalog at `ACTIVE`.
- Dashboard: profile option, `wordpress-api` credential form, read-probe
  summary panel, Administrator risk warning, no GitHub/Vercel sections for
  this profile.
- Locales per client; default monolingual, `translationPolicy: none`.

### Verification flow (`wordpress-api`)

All calls are read-only and go to the configured site origin only.

1. `GET {origin}/wp-json` — REST discovery; record REST base and namespaces;
   require `wp/v2`.
2. `GET {restBase}/wp/v2/users/me?context=edit` (Basic auth) — record user id,
   username and roles; require `edit_posts`. Role must be `editor` or
   `administrator`; `administrator` sets `riskWarning: administrator_role`.
3. Read probe: `GET {restBase}/wp/v2/posts?per_page=5&status=publish,draft`
   and `GET {restBase}/wp/v2/categories?per_page=20` — store counts and up to
   five latest post titles as allowlisted evidence.

Network rules: HTTPS only; never follow a redirect to another host; 30 s
timeout per request; one retry on idempotent reads; bounded response size.
`http://localhost` only behind a development-only flag. Private/loopback
address blocking is not required in v1 (ADR-0066 accepted risk).

### Out of scope

- Any content tool (create/edit posts, pages, media, categories).
- WordPress headless (Astro + WP), WooCommerce, WPML/Polylang, WordPress.com
  OAuth, GitHub theme/plugin repos, webhooks from WordPress.
- WebOps Signed Preview plugin (not required; ADR-0006 still binds future
  tools).
- Hey Binn WordPress site excerpts (Binn runs without site context in v1).
- Changes to frozen stacks.

### Failure modes

| Failure | Result |
|---------|--------|
| Origin not HTTPS | Candidate rejected before any call (`validation_error`) |
| Redirect to another host | Verify fails `policy_denied`; password never re-sent |
| `/wp-json` missing or REST disabled by a security plugin | `invalid`, stable code `wordpress_rest_unavailable` |
| 401/403 on `users/me` | `invalid`, `wordpress_auth_failed` |
| Role lacks `edit_posts` (subscriber/contributor/author) | `invalid`, `wordpress_role_insufficient` |
| Timeout / 5xx / network | Previous status preserved; retry allowed (ADR-0014); dashboard shows timeout |
| `productionDomain` host ≠ site origin host | Validate check `production_domain_matches_site_url` fails |
| GitHub / Vercel binding attempted on this profile | `policy_denied` |
| Tool from another profile assigned | Profile-incompatible, fail closed |

### Acceptance criteria

1. Operator can create an enrollment with `wordpress_rest`.
2. `wordpress-api`, OpenAI and Telegram client verify without any WordPress
   mutation; GitHub/Vercel are not required and are rejected for this profile.
3. Validate shows the read-probe summary and reaches `ready_for_pairing`.
4. Pairing activates the enrollment with zero tools; `/help` and Hey Binn
   reply; `/tools` reports the empty catalog.
5. Administrator role verifies with a visible risk warning.
6. Frozen stacks pass their regression suites.

## Governance approvals

| Decision | User choice | Date |
|----------|-------------|------|
| Phase 2 rule change (SCOPE/ROADMAP/PRODUCT, INTEGRATIONS, SECURITY + ADR-0066) | Approve | 2026-10-13 |
| Signed Preview plugin not required (enrollment or tools); ADR-0006 unchanged | Confirm | 2026-10-13 |
| Role Editor or Administrator (warning) | Confirm | 2026-10-13 |
| SSRF: HTTPS + no cross-host redirects + 30 s timeout; no private-IP block | Confirm | 2026-10-13 |
| Empty catalog ACTIVE; first capability deferred | Confirm | 2026-10-13 |

## Documentation impact assessment

Required by [`AGENTS.md`](../../AGENTS.md):

- Canonical documents changed: `SCOPE.md`, `ROADMAP.md`, `PRODUCT.md`,
  `ARCHITECTURE.md`, `CONTRACTS.md`, `SECURITY.md`, `INTEGRATIONS.md`,
  `ONBOARDING.md`, `ENROLLMENT.md`, `DASHBOARD.md`, `DATA-MODEL.md`,
  `TESTING.md`, `GLOSSARY.md`, `CHANGELOG.md`, `adr/README.md`,
  `DECISIONS.md`, BSI index + `docs/guides/BSI/stacks/wordpress-rest.md`,
  this spec.
- ADRs added: **ADR-0066**. Confirmed unchanged: ADR-0006, ADR-0007,
  ADR-0014, ADR-0042, ADR-0062, ADR-0064.
- Public contracts: `selectableEnrollmentProfileSchema`, `integrationKindSchema`
  (`wordpress-api`), `projectManifestSchema` (profile-dependent `repository` /
  `deployment`, `content.source: 'wordpress'`, `wordpress` block), credential
  evidence schema for `wordpress-api`, activation check names.
- Migration: none expected for the database (profile and kind are text
  columns); record a ship-marker migration only if implementation needs one.
  Rollback: remove `wordpress_rest` from the selectable list; existing
  enrollments stay readable.
- Tests: contracts, verifier, onboarding (empty catalog, no GitHub/Vercel),
  dashboard profile gating, frozen-stack regression.

## Compatibility

- Tools / executorIds / ports affected: none until create-tool.
- ADR-0042: new WordPress REST port owned by this stack; no shared factory
  defaults widened. OpenAI used as on other stacks.
- `resolveManifestBindings` and `credentialChecksForProfile` gain a
  `wordpress_rest` branch; other branches unchanged.
- Hey Binn site-context loader skips GitHub reads for `wordpress_rest`.

## Open questions

- Pilot / staging WordPress site (before ENROLLMENT.md section B).
- Preview strategy for the first mutating tool (ADR-0006 compliance).
- Where a WordPress BSI inventory would live (no Git) if tools need one.

## Handoff

- Readiness handoff: [`wordpress-rest-readiness-handoff.md`](wordpress-rest-readiness-handoff.md).
- Implementation is a **separate** Agent session; first capability →
  [`create-tool`](../../.cursor/skills/create-tool/SKILL.md) using
  [`.cursor/skills/create-tool/references/stacks/wordpress-rest.md`](../../.cursor/skills/create-tool/references/stacks/wordpress-rest.md).
- Operator runbook: [`docs/ENROLLMENT.md`](../ENROLLMENT.md) section B.

## References

- [ADR-0066](../adr/0066-wordpress-rest-enrollment.md),
  [ADR-0006](../adr/0006-preview-and-approval.md),
  [ADR-0045](../adr/0045-astro-orbitype-enrollment.md),
  [ADR-0059](../adr/0059-shopify-liquid-enrollment.md)
- BSI: [docs/guides/BSI/stacks/wordpress-rest.md](../guides/BSI/stacks/wordpress-rest.md)
