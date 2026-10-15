# Readiness handoff: `wordpress-rest` / `wordpress_rest`

- Spec: [`docs/specs/wordpress-rest-enrollment.md`](wordpress-rest-enrollment.md)
- ADR: [ADR-0066](../adr/0066-wordpress-rest-enrollment.md)
- Date: 2026-10-13
- Prepared by: new-stack skill
- Status: Implemented (tasks 1–7); task 8 smoke pending a pilot site

## Implementation notes

- Task 1 shipped as a separate strict `wordpressRestManifestSchema` plus the
  union `anyProjectManifestSchema` instead of making `repository` /
  `deployment` optional in `projectManifestSchema`. Frozen Git-backed readers
  keep their exact types; generic readers (onboarding, manifest API,
  Hey Binn) parse the union and branch on `profile`.
- Package `@binflow/wordpress`: read-only REST client + verifier. Verifier
  budget is 150 s total (`CredentialVerifier.timeoutMs`) so the 30 s
  per-request timeout and one retry are not cut short by the 15 s default.
- Same-origin redirects (≤3) are followed; any host or protocol change is
  `policy_denied` `wordpress_redirect_cross_host` and the password is never
  re-sent.
- Dev-only `BINFLOW_WORDPRESS_ALLOW_INSECURE_LOCALHOST` (OPERATIONS).

## Summary

After implementation, operators can enroll a classic self-hosted WordPress
site with profile `wordpress_rest`: verify a `wordpress-api` Application
Password (Editor or Administrator with warning) plus OpenAI and the Telegram
client bot, see a read-probe summary, pair the client bot and reach `ACTIVE`
with zero tools. No GitHub or Vercel is involved. All live stacks stay frozen.

## Explicit freezes

- `astro_repo` / Webbin, `astro_orbitype`, `shopify_liquid`: enrollment,
  tools, executors, path builders, manifest requirements.
- Global admin Telegram topology (ADR-0007); single polling worker.
- ADR-0042 shared port scopes; no wider factory defaults.
- ADR-0006 preview/approval (unchanged).

## Empty catalog

- Allowed at `ACTIVE`: **yes**
- Notes: `/tools` reports the empty catalog; Hey Binn stays enabled without
  WordPress site excerpts.

## Ordered implementation tasks

1. **Contracts + tests** (`packages/contracts`, `docs/CONTRACTS.md` already
   updated)
   - Add `wordpress_rest` to `selectableEnrollmentProfileSchema`.
   - Add `wordpress-api` to `integrationKindSchema` + candidate/config schema
     (site origin HTTPS, username) + strict evidence schema (REST base, user
     id, role, `riskWarning`, probe counts, ≤5 titles).
   - `projectManifestSchema`: make `repository` / `deployment` profile-
     dependent (required for existing profiles, absent for `wordpress_rest`);
     add `wordpress` block; allow `content.source: 'wordpress'`.
   - Contract tests proving existing profiles still require `repository`.
2. **WordPress verifier package** (e.g. `@binflow/wordpress`)
   - Read-only verifier: discovery → `users/me?context=edit` → read probe.
   - HTTP client: HTTPS only (dev-only localhost flag), no cross-host
     redirects, 30 s timeout, 1 retry on reads, bounded body, endpoint
     allowlist (no plugins/themes/users-write/settings/menus).
   - Stable error codes: `wordpress_rest_unavailable`, `wordpress_auth_failed`,
     `wordpress_role_insufficient`, `policy_denied` (redirect), timeout as
     retryable (ADR-0014).
   - Unit tests with fixtures only (no live secrets).
3. **Integration admin + CLI** (`packages/integration-admin`, CLI)
   - Register/verify/revoke `wordpress-api` (project scope).
   - Reject `github-app` / `vercel` bindings for `wordpress_rest`
     (`policy_denied`), mirroring the Shopify Vercel guard.
4. **Manifests + onboarding** (`packages/manifests`, `packages/onboarding`)
   - Global profile stub `wordpress_rest@1` and `buildWordpressRestManifest`
     (empty catalog allowed, locale rules as Shopify).
   - `credentialChecksForProfile`: `openai_credential`,
     `telegram_admin_credential`, `telegram_client_credential`,
     `wordpress_api_credential`; plus `wordpress_read_probe` and
     `production_domain_matches_site_url`.
   - `resolveManifestBindings`: `wordpress_rest` branch reading
     `wordpress-api` evidence; no GitHub evidence required.
5. **Dashboard**
   - Profile option; `wordpress-api` form (password write-only); hide GitHub/
     Vercel sections; read-probe panel; Administrator risk banner; inline
     timeout + retry.
6. **Worker / Hey Binn**
   - `loadHeyBinnSiteContext`: skip GitHub reads for `wordpress_rest` (no
     excerpts in v1). No capability wiring.
7. **Regression** for frozen stacks (enrollment + tool suites).
8. **Smoke** per ENROLLMENT.md section B once a pilot exists.

Do **not** start these tasks inside new-stack.

## Tests minimum

- Contracts: selectable profile, kind, manifest variants (with/without
  repository by profile).
- Verifier: success (Editor), success + warning (Administrator), insufficient
  role, 401, REST disabled, cross-host redirect, non-HTTPS origin, timeout.
- Onboarding: Validate without GitHub/Vercel; empty catalog ACTIVE;
  `productionDomain` host mismatch fails.
- Integration admin: GitHub/Vercel binding rejected for `wordpress_rest`.
- Frozen stacks: existing enrollment and tool suites green.

## Ops notes

- Single Telegram polling worker.
- Client bot hot-load on heartbeat.
- ENROLLMENT.md section B after ship; WordPress troubleshooting rows already
  in section A6.
- Some hosts strip the `Authorization` header or block `/wp-json` via
  security plugins — operator fixes on the WordPress side.

## Next requests (for the user)

1. **Implementation session** — Agent mode with this handoff + spec + ADR-0066.
2. **Stack tool contract** — written:
   `.cursor/skills/create-tool/references/stacks/wordpress-rest.md`.
3. **BSI stack brief** — written: `docs/guides/BSI/stacks/wordpress-rest.md`
   (indexed in `docs/guides/BSI/README.md`).
4. **First capability** — [`create-tool`](../../.cursor/skills/create-tool/SKILL.md)
   after enrollment works; must define its ADR-0006 preview.
5. **test-tool** — after ship, with the same stack contract.
6. **Operator enrollment** — [`docs/ENROLLMENT.md`](../ENROLLMENT.md).

## Stack tool contract path

- File: `.cursor/skills/create-tool/references/stacks/wordpress-rest.md`
- Index: `.cursor/skills/create-tool/references/stacks/README.md`
- Status: written

## BSI stack brief path

- File: `docs/guides/BSI/stacks/wordpress-rest.md`
- Index: `docs/guides/BSI/README.md`
- Platform guide: `docs/guides/BSI/binflow-surface-inventory.md`
- Status: written

## Out of scope for the impl session

- Any WordPress content tool or `packages/tools/stacks/wordpress-rest/`.
- Signed Preview plugin, webhooks, headless WP, WooCommerce, WPML/Polylang,
  WordPress.com OAuth.
- Hey Binn WordPress site context.
