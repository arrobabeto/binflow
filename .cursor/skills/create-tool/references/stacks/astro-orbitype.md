# Stack contract: astro-orbitype

| Field | Value |
|-------|-------|
| Catalog stack | `astro-orbitype` |
| Project profile | `astro_orbitype` |
| Pilot reference | Bistro (`bistrozurlinde.ch`) |
| Empty catalog at ACTIVE | **Yes** |
| Required credentials | GitHub App, Vercel, **Orbitype API** |
| Enrollment | **`productionDomain` required**; selectable locales (incl. monolingual `de`); translation policy per ADR-0046 |
| Implementation guide | [docs/guides/astro-orbitype-tool-implementation.md](../../../../docs/guides/astro-orbitype-tool-implementation.md) |

## Path / route conventions

- Blog markdown: `src/content/blog-{locale}/*.md` (direct files).
- Images: `public/images/blog/*`.
- CMS allowlist as needed (`cms/collections/**`).
- Preview / production: `/posts/{draftId}/{titleSlug}` via `routePrefix: /posts`.
- Branch pattern: `bot/{projectKey}/{capability}/...`.

## Production origin

- Always freeze `deployment.productionOrigin` from enrollment `productionDomain`.
- Worker → Vercel port must pass that origin. **Never** default Orbitype clients
  to webbin.com.mx (ADR-0048).

## Ports / ADR-0042

- GitHub publication: **enrolled** repo/branch (non-Webbin unit test required).
- Orbitype dual-write: real CMS columns; 4xx → `provider_final`.
- Vercel: Preview + Production `PUBLIC_*` env; pass `productionOrigin`.
- Catalog scope declared per capability.

## Rematerialize triggers

`editablePaths`, `routePrefix`, `productionOrigin`, publicationTargets, locale
collections. After change: rematerialize script + verify version + fields (noop
is failure if field still missing).

## Telegram / copy

- Production buttons: enrolled origin only.
- No Webbin path examples (`/articulos`) in Orbitype client copy.
- Customization: voice only — no paths/models.

## Live smoke gates

1. One polling worker; bot not send-only.
2. Preview `PUBLIC_SITE_URL` (and other `PUBLIC_*`) set.
3. Preview Deployment Protection disabled for review.
4. First publish: production URL host == enrollment domain.
5. Admin ready outbox + client notice on `FAILED_FINAL`.

## Failure checklist (Bistro-learned)

| # | Check |
|---|--------|
| 1 | Non-Webbin GitHub draft works |
| 2 | Single poller / lock promote |
| 3 | Path matcher + `blog-*/*.md` rematerialized |
| 4 | Orbitype schema + provider_final on 4xx |
| 5 | Preview env complete |
| 6 | `/posts/{id}/{slug}` preview routes |
| 7 | `pull_requests` unique per project |
| 8 | productionOrigin from manifest |
| 9 | Preview SSO off |
| 10 | Manifest fields actually present after remat |
| 11 | Notify paths |
| 12 | Locales from manifest only |
| 13 | Generate fails closed if prose language ∉ contentLocales |

## Freeze vs Webbin

Do not reuse `astro_repo` path builders, webbin branch patterns, or pilot URL
constants. Keep Webbin tools untouched; this contract is Orbitype-only.
