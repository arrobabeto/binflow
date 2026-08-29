# ADR-0026: Telegram inline action buttons

- Status: Accepted
- Date: 2026-08-19
- Supersedes: None
- Superseded by: None

## Context

Plan confirmation and preview decisions are authorized by hashed, single-use
action tokens. The Chat SDK ingress previously rendered those tokens as
`/action <token>` text. Clients had to copy a long opaque string, and preview
notices from the worker used the same pattern. `docs/TELEGRAM.md` already
requires buttons that carry only opaque identifiers.

Vercel Deployment Protection on the Webbin project can still require a Vercel
login for `*.vercel.app` preview hostnames. Shareable-link minting is out of
scope; the operator may disable preview protection so URL buttons open without
a Vercel account.

## Decision

1. Every client-visible notice that carries action tokens is posted as a Chat
   SDK card with Telegram inline keyboard buttons. This includes plan
   confirmation in the Chat handler and worker-originated preview, revision and
   cancel notices. The first interaction is not special; later workflow steps
   use the same card path.
2. Visible message text never includes `/action <token>` or a dump of raw
   action URLs. Each action button’s callback identifier is the opaque token
   itself.
3. Preview notices add URL buttons for the Spanish (`/es/articulos/...`) and
   English (`/articulos/...`) preview routes in addition to approve,
   request-changes and cancel actions.
4. Publication-complete notices add URL buttons for those routes on the live
   production origin. They do not attach action tokens.
5. `callback_query` updates enter the same `TelegramIngress` contract as
   `/action <token>`. Authorization uses the clicking user’s Telegram numeric
   ID from the callback, not the original message author (the bot).
6. Typed `/action <token>` remains a supported fallback for tests and
   accessibility. It is not the primary client-visible control.
7. Binflow does not mint Vercel shareable preview secrets. Public preview
   access is an operator setting on the Vercel project.

## Consequences

- Telegram callback payloads stay within the 64-byte Bot API limit because
  action tokens are 32-byte `base64url` values and Chat SDK encoding does not
  attach a second payload field.
- Replay isolation still keys on bot ID plus update ID; callback query IDs are
  the update identity for button clicks.
- Clients can open exact preview URLs from Telegram once Deployment Protection
  no longer requires Vercel Authentication for those deployments.

## Alternatives considered

- Vercel shareable links (`protectionMode: share_link`): rejected for this
  change because the operator will disable Deployment Protection instead.
- Encoding action names in `callback_data` and looking up tokens server-side:
  rejected because the existing hashed token already is the opaque identifier.

## Verification

Messaging tests prove action tokens render as card buttons for plan and
preview, publication notices use live-origin URL buttons, callback dispatch
uses the clicker identity, and `/action` still consumes the same token. The
worker posts those cards through the Telegram adapter; it never concatenates
slash commands into client-visible copy.
