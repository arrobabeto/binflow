# Stack contract: astro-repo

| Field | Value |
|-------|-------|
| Catalog stack | `astro-repo` |
| Project profile | `astro_repo` |
| Pilot | Webbin (`tenantKey` / `projectKey` webbin) |
| Empty catalog at ACTIVE | **No** — Webbin ships with default capability bindings |
| Required credentials | GitHub App, Vercel (OpenAI per-client) |
| Enrollment | Locales bilingual ES+EN typical; `productionDomain` optional (defaults to Webbin pilot origin) |
| Implementation guide | Webbin tools are the reference; Orbitype guide does **not** apply |

## Path / route conventions

- Blog: `src/content/articulos/*.md`, `articulos-es`, public images under
  `public/images/articles/`.
- Portfolio: `proyectos` / `proyectos-es`.
- Preview / production routes: `/articulos/{slug}`, `/es/articulos/{slug}` (and
  portfolio equivalents).
- Branch pattern: `bot/webbin/{capability}/...` (pilot builder).

## Production origin

- Frozen `deployment.productionOrigin` when enrollment sets `productionDomain`.
- Fallback: `webbinPilotBinding.productionOrigin` (`https://webbin.com.mx`) for
  `astro_repo` when origin is missing — **do not remove** without rematerializing
  Webbin.

## Ports / ADR-0042

- GitHub catalog + publication scoped to enrolled Webbin repo.
- Vercel wait uses passed `productionOrigin` (pilot fallback OK for Webbin).
- No Orbitype port.

## Rematerialize triggers

`editablePaths`, portfolio paths, redirects path, AVIF paths, `productionOrigin`.

## Telegram / copy

- Success URLs come from `productionUrls` evidence (live origin).
- Shared guidance examples must stay **neutral** (`example.com`); do not bake
  webbin.com.mx into shared workflow strings.
- Webbin editorial voice only in `customizations/webbin.md`.

## Live smoke

- Single Telegram poller; Preview protection off for client review.
- Assert production button host is webbin.com.mx for Webbin publishes.

## Freeze (do not “genericize” casually)

- Pilot repo/branch asserts, `articulos`/`proyectos` layouts, bilingual
  `always_translate` defaults, `webbin*` capability binding names.
- Changing builder paths requires Webbin rematerialize + full tool regression.
