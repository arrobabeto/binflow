# ADR-0066: WordPress REST enrollment (`wordpress_rest`) without GitHub

- Status: Accepted
- Date: 2026-10-13
- Supersedes: None
- Superseded by: None
- Amends: `docs/INTEGRATIONS.md` “Future WordPress”, `docs/SECURITY.md` SSRF row
  (for the WordPress site origin only), `docs/SCOPE.md` WordPress exclusion

## Context

`wordpress_rest` has been a reserved project profile since the first MVP.
ROADMAP Phase 7 and INTEGRATIONS “Future WordPress” described a REST adapter
limited to posts, categories and blog media, authenticated with a revocable
Application Password, and required an audited “WebOps Signed Preview” plugin
**before** the profile could be activated. SCOPE listed WordPress runtime
support as a separate later phase.

Every live profile (`astro_repo`, `astro_orbitype`, `shopify_liquid`) enrolls
through a GitHub App binding. Classic WordPress sites have no repository: all
operations go through the WordPress REST API. The code-level project manifest
(`projectManifestSchema`) still requires `repository` and `deployment`, while
CONTRACTS already documents both as optional and lists `content.source:
'wordpress'`.

The operator wants a classic (non-headless) WordPress stack enrolled directly
against the REST API, with no tools yet.

Related binding decisions that remain unchanged: ADR-0006 (preview and
approval), ADR-0007 (bot topology), ADR-0014 (credential scope and
verification), ADR-0020 (catalog bindings), ADR-0042 (tool isolation),
ADR-0045 / ADR-0059 (enrollment precedents), ADR-0062 (Hey Binn), ADR-0064
(BSI per-stack briefs).

## Decision

1. **Profile and stack.** Activate the reserved project profile
   `wordpress_rest` with catalog stack id `wordpress-rest`. Scope is **classic
   self-hosted WordPress** operated only through the REST API. The profile
   becomes selectable for enrollment once implemented.

2. **No GitHub, no Vercel.** Enrollment requires a new project-scoped
   credential kind `wordpress-api`, the tenant OpenAI credential, the dedicated
   Telegram client bot and `productionDomain`. `github-app` and `vercel` are
   neither required nor authorized for this profile. The project manifest for
   `wordpress_rest` omits `repository` and `deployment` and carries a
   `wordpress` block instead (see CONTRACTS).

3. **Credential.** `wordpress-api` uses a native WordPress **Application
   Password** (username + application password, HTTP Basic over HTTPS).
   Encrypted: application password only. Non-secret configuration: site
   origin, username, discovered REST base, verified user id and role.

4. **Role.** The WordPress user may be **Editor** or **Administrator**.
   Administrator is accepted with a persistent dashboard risk warning (accepted
   operator risk). Regardless of role, the Binflow WordPress adapter calls only
   an allowlisted set of REST endpoints; plugins, themes, users, settings and
   menus endpoints are never callable by Binflow code.

5. **Read-only verification + read probe.** Verify performs, without any
   mutation: REST discovery (`GET /wp-json`), identity and capabilities
   (`GET /wp/v2/users/me?context=edit`, must be able to edit posts) and a
   **read probe** (first page of posts and categories). The probe summary
   (counts, latest titles) is stored as allowlisted evidence and shown in the
   dashboard.

6. **Network rules for the site origin.** HTTPS only; redirects to a different
   host are not followed (the Application Password is never sent off-origin);
   30 s timeout per request with one retry for idempotent reads. Private/
   loopback address blocking is **not** required for the WordPress site origin
   in v1 (accepted risk: only an authenticated `platform_owner` with TOTP
   enters the origin). Local development may allow `http://localhost` behind
   an explicit development-only flag. Verify timeouts surface to the operator
   in the dashboard; tool-run timeouts (future) notify the client via
   Telegram.

7. **Signed Preview plugin no longer an activation gate.** The audited
   “WebOps Signed Preview” plugin is **not** required for enrollment and is not
   pre-declared as a requirement for tools. ADR-0006 stays binding: every
   future WordPress capability must still define an exact, version-bound
   preview artifact (decided per capability via create-tool, or by a later ADR
   that supersedes ADR-0006).

8. **Empty catalog at ACTIVE.** Like ADR-0045 / ADR-0059, enrollment may reach
   `ACTIVE` with zero capability bindings. No content tools ship with this
   ADR.

9. **Locales.** Configured per client; default monolingual with
   `translationPolicy: none`. Multilingual WordPress plugins (WPML, Polylang)
   are not supported. No Webbin overlays apply.

10. **Hey Binn.** Binn stays enabled on the client bot. In v1 it runs without
    site excerpts for `wordpress_rest` (its site context loader is GitHub-based);
    WordPress-sourced Binn context is a later change.

11. **BSI.** A `wordpress-rest` BSI stack brief exists (ADR-0064). BSI is not
    required at enrollment; Git-hosted inventory does not apply to a site with
    no repository.

12. **Freeze.** `astro_repo` (Webbin), `astro_orbitype`, `shopify_liquid`
    enrollment, tools, executors, shared-port defaults and Telegram topology
    do not change.

## Consequences

- Positive: first enrollment path without GitHub; operators can onboard
  WordPress clients and validate API access before any tool exists.
- Cost: manifest contract becomes profile-dependent (`repository` /
  `deployment` optional, `wordpress` block); onboarding binding resolution
  must branch by profile.
- Risk: Administrator Application Passwords grant full site control if leaked;
  mitigated by encryption, endpoint allowlist, read-only enrollment and
  revocability. Reduced SSRF controls on the site origin are an accepted risk.
- Risk: future tools must solve preview without the Signed Preview plugin.
- SCOPE / ROADMAP / PRODUCT expand for enrollment only.

## Alternatives considered

- Keep the Signed Preview plugin as an activation gate: rejected by product
  owner (blocks enrollment before any tool exists).
- Editor-only role: recommended, rejected by product owner in favor of Editor
  or Administrator with warning.
- Full SSRF controls (DNS/IP validation) for the site origin: offered,
  rejected for v1 by product owner.
- Optional GitHub App binding for a theme/plugin repo: out of scope.

## Verification

- Spec `docs/specs/wordpress-rest-enrollment.md` approved.
- Contract tests: `wordpress_rest` selectable; `wordpress-api` kind; manifest
  without `repository`/`deployment` only for `wordpress_rest`.
- Verifier tests: discovery, role/capability check, read probe, cross-host
  redirect refusal, HTTPS enforcement, timeout classification (no live
  secrets in fixtures).
- Enrollment tests: empty catalog ACTIVE; GitHub/Vercel bindings rejected for
  this profile; frozen-stack regression green.
- create-tool blocked until
  `.cursor/skills/create-tool/references/stacks/wordpress-rest.md` exists.

## See also

- Spec: [wordpress-rest-enrollment.md](../specs/wordpress-rest-enrollment.md)
- [ADR-0006](0006-preview-and-approval.md)
- [ADR-0045](0045-astro-orbitype-enrollment.md)
- [ADR-0059](0059-shopify-liquid-enrollment.md)
- [ADR-0064](0064-optional-bsi-astro.md)
- BSI brief: [docs/guides/BSI/stacks/wordpress-rest.md](../guides/BSI/stacks/wordpress-rest.md)
