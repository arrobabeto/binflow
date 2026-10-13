# Stack contract: wordpress-rest

| Field | Value |
|-------|-------|
| Catalog stack | `wordpress-rest` |
| Project profile | `wordpress_rest` |
| Pilot reference | TBD (WordPress staging/pilot defined before ENROLLMENT.md section B) |
| Empty catalog at ACTIVE | **Yes** |
| Required credentials | `wordpress-api` (Application Password; Editor or Administrator with warning), OpenAI, Telegram client; **`productionDomain` required** (host = site origin) |
| Enrollment | **No GitHub, no Vercel** (rejected for this profile). Manifest has no `repository` / `deployment`; carries `wordpress` block. Locales per client; default monolingual + `translationPolicy: none`. |
| Implementation guide | TBD until first tool ships (`docs/guides/wordpress-rest-tool-implementation.md` when it does) |
| BSI implementer brief | [docs/guides/BSI/stacks/wordpress-rest.md](../../../../../docs/guides/BSI/stacks/wordpress-rest.md) (optional; declare-only; no Git inventory) |

## Path / route conventions

- No file paths: content is addressed by REST resources under the discovered
  REST base (`wp/v2/posts/{id}`, `wp/v2/categories`, `wp/v2/media/{id}`, …).
- `editablePaths` / `blockedPaths` express **REST resource allowlists**, not
  repo globs. Plugins, themes, users, settings and menus endpoints are always
  blocked (ADR-0066), regardless of the WordPress role.
- Preview / production route: post/page `link` returned by REST on the
  enrolled origin. Each tool must define an exact, version-bound preview
  artifact (ADR-0006); the WebOps Signed Preview plugin is **not** assumed.
- No branch pattern (no Git).

## Production origin

- `productionOrigin` = enrollment `productionDomain`; its host must equal
  `wordpress.siteOrigin` host.
- No Vercel wiring. Never default to Webbin, Bistro or elayva origins.

## Ports / ADR-0042

- Publication: dedicated WordPress REST port owned by this stack; each
  capability declares the exact endpoints/methods it may call.
- Network: HTTPS only, no cross-host redirects, 30 s timeout, one retry on
  idempotent reads, bounded bodies (ADR-0066). Mutations must be idempotent
  (look up by Binflow request key before create).
- OpenAI: scoped per capability, as on other stacks.
- **Do not** call GitHub, Vercel, Orbitype or Shopify ports from this stack.
- Do not widen shared factory defaults for Astro or Shopify.
- Catalog: capabilities bind only to `wordpress_rest` / `wordpress-rest`.

## Rematerialize triggers

`wordpress.siteOrigin`, `wordpress.restBase`, verified user/role (credential
re-verify), `productionOrigin`, locales, REST allowlists. After change:
rematerialize + verify fields landed (noop is failure if field still missing).

## Telegram / copy

- Client-visible links use the enrolled origin only (ADR-0048).
- Tool-run timeouts against the WordPress host notify the client via Telegram
  with a retry-safe message (ADR-0066).
- No Astro/Shopify paths or Git/PR wording in client copy for this stack.
- Customization: voice/audience only.

## Live smoke gates

1. One polling worker; client bot not send-only.
2. Enrollment Validate with `wordpress-api` + read probe; no GitHub/Vercel.
3. `ACTIVE` with zero capability bindings; `/help` and Hey Binn reply.
4. After create-tool: tool calls only its allowlisted endpoints; preview +
   approval bind to the exact WordPress revision/artifact (ADR-0006).
5. Assigning tools from other profiles fails closed.

## Failure checklist (stack-specific)

| # | Check |
|---|--------|
| 1 | `wordpress-api` verify: discovery, role gate, read probe |
| 2 | HTTPS only; cross-host redirect refused; password never sent off-origin |
| 3 | Timeout classified as retryable; client notified on tool runs |
| 4 | No GitHub/Vercel bindings accepted for this profile |
| 5 | Endpoint allowlist enforced in code, not by WordPress role |
| 6 | Administrator role shows dashboard risk warning |
| 7 | productionOrigin host = site origin host |
| 8 | Preview artifact defined per tool (ADR-0006) |
| 9 | Single Telegram poller |
| 10 | Locales from manifest only; no WPML/Polylang |

## Freeze vs existing stacks

Do not change `astro_repo` / Webbin, `astro_orbitype` or `shopify_liquid`
enrollment, executors, path builders or shared-port defaults. Manifest schema
changes (`repository` / `deployment` optional) must keep those profiles
requiring them exactly as today.
