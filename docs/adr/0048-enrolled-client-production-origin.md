# ADR-0048: Enrolled client production origin

- Status: Accepted
- Date: 2026-08-30
- Supersedes: [ADR-0029](0029-client-visible-production-origin.md) decision 1
  for multi-tenant enrolled domains only (Webbin pilot default unchanged)
- Superseded by: None

## Context

ADR-0029 fixed client-visible live URLs so Telegram publication notices never
use rotating `*.vercel.app` hostnames. For the Webbin pilot that meant a
code-owned constant `https://webbin.com.mx`.

Astro+Orbitype enrollment (ADR-0045) stores each client's public site as
`enrollment.configuration.productionDomain` (for example Bistro
`https://www.bistrozurlinde.ch/`). Publication-complete notices still called
`selectClientProductionOrigin()` with no argument, so Bistro clients received
`https://webbin.com.mx/posts/...` after a successful publish.

## Decision

1. Client-visible production URLs use the enrolled project's production origin,
   never a unique Vercel hostname.
2. Manifest materialization freezes
   `deployment.productionOrigin` from enrollment `productionDomain`
   (HTTPS origin, no trailing slash). Webbin `astro_repo` without an enrolled
   domain continues to default to `webbinPilotBinding.productionOrigin`.
3. The Vercel deployment port accepts an optional `productionOrigin`. The
   worker resolves it from the frozen request-version manifest first, then the
   active enrollment `productionDomain`, then the Webbin pilot default.
4. Unique `*.vercel.app` hostnames remain preview-grade only (ADR-0029
   decisions 2–3 unchanged).

## Consequences

- Bistro (and other enrolled clients) open their own domain after publication.
- Operators rematerialize manifests after this ADR so existing Orbitype pilots
  freeze `deployment.productionOrigin`.
- Runs that started before rematerialization still fall back to enrollment
  `productionDomain` at execute time.

## Alternatives considered

- Keep a single code-owned Webbin origin for all tenants: rejected; wrong host
  in client notices.
- Always read live Vercel custom domains: rejected in ADR-0029; list can be
  empty or wrong.
- Only patch Telegram templates: rejected; stored `productionUrls` evidence
  would stay wrong.

## Verification

- Manifest builders emit `deployment.productionOrigin` from enrollment.
- Vercel port tests build production route URLs from an enrolled origin.
- Rematerialize Bistro:
  `pnpm --filter @binflow/tools exec tsx scripts/refresh-bistro-manifest-blog-paths.ts`.
