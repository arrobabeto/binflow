# ADR-0029: Client-visible production origin

- Status: Accepted
- Date: 2026-08-19
- Supersedes: ADR-0028 decision 3 for client-visible production URLs only
- Superseded by: [ADR-0048](0048-enrolled-client-production-origin.md) for
  multi-tenant enrolled `productionDomain` (Webbin pilot default remains)

## Context

ADR-0028 allowed publication to finish when Vercel listed no usable custom
domain by falling back to the production deployment origin, including a unique
`*.vercel.app` hostname. A live Webbin publication then sent the client
`https://webbin-<id>-arrobabetos-projects.vercel.app/...` after the article was
already on the public site. An earlier draft of this decision used
`https://webbin.dev`, which is not the live site. The Webbin public origin is
`https://webbin.com.mx`. Unique Vercel hostnames are preview-grade.

## Decision

1. Client-visible production URLs (Telegram publication notices, stored
   production evidence, dashboard links) use
   `webbinPilotBinding.productionOrigin` (`https://webbin.com.mx`).
2. Unique per-deployment `*.vercel.app` hostnames, Vercel app aliases and other
   hostnames returned by the Vercel domain list are never shown as the live
   site. Preview notices may still use the unique preview deployment origin.
3. Publication still completes after a successful GitHub merge when Vercel
   domain listing is empty or unusable; it does not fail solely to obtain a
   hostname. The live origin is code-owned for the Webbin pilot.

## Consequences

- Clients open `https://webbin.com.mx/...` after publication, not a rotating
  Vercel deployment hostname and not `webbin.dev`.
- Operators still disable preview Deployment Protection separately; that does
  not change the live origin.

## Alternatives considered

- Keep unique deployment hostnames as last resort: rejected because the client
  already has a stable public domain and those URLs look unpublished.
- Derive the live origin from whatever custom domain Vercel lists: rejected
  because that list can be empty or contain a hostname that is not the public
  site (`webbin.dev`).
- Mint a Vercel production alias per article: rejected as unnecessary for the
  Webbin pilot.

## Verification

Vercel tests build production route URLs from `https://webbin.com.mx` when the
domain list is empty or contains only Vercel app hostnames. Messaging tests
render publication notices with those live origins as URL buttons.
