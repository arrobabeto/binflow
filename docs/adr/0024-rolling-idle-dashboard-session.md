# ADR-0024: Rolling idle dashboard session

- Status: Accepted
- Date: 2026-08-19
- Supersedes: The fixed session-duration and freshness timing in ADR-0016
- Superseded by: None

## Context

ADR-0016 configured a 12-hour database session and a separate five-minute
freshness window. In the single-owner first MVP that split makes ordinary
administration fail after five minutes while the underlying session remains
usable for twelve hours. It also lets a browser restore a protected dashboard
document after the owner expects the session to have ended.

## Decision

- A TOTP-verified dashboard session has a rolling 30-minute inactivity limit.
  Authenticated activity may extend the database expiry at most once per
  minute; cookie session caching remains disabled.
- The first MVP has no independent five-minute freshness window. A sensitive
  mutation requires the same non-idle, TOTP-verified server session as other
  business operations. TOTP is still required on every new login.
- The server is authoritative. A session whose database expiry or last
  activity is older than the idle limit is rejected as unauthenticated.
  Dashboard SSR resolves that session from the incoming cookie in-process;
  it does not nested-fetch the auth HTTP handler while rendering a document.
- The browser also maintains a 30-minute deliberate-interaction timer. On
  expiry it signs out and replaces the document with `/login`; it never leaves
  a protected route in history as a usable surface.
- Protected navigation revalidates the server session with the cookie cache
  disabled. Restored/back-forward-cache documents and a tab returning to the
  foreground revalidate before remaining usable. Dashboard and auth responses
  are marked `no-store`.

## Consequences

- An owner who is actively using the dashboard is not interrupted every five
  minutes.
- Thirty minutes without deliberate browser activity requires password and
  TOTP again, even if an old document is restored with Back.
- Existing 12-hour sessions are not grandfathered: their persisted last
  activity must satisfy the new idle limit.
- A one-minute server refresh cadence adds a small number of database writes,
  acceptable for the single-owner MVP.

## Alternatives considered

- Extend only the freshness window to 30 minutes: rejected because the
  underlying 12-hour session and restored-document problem would remain.
- Use a fixed 30-minute lifetime: rejected because it interrupts an owner who
  is actively working.
- Trust only a browser timer: rejected because client state is not an
  authorization boundary.

## Verification

Tests cover the 30-minute constants, rolling server expiry, rejection after
idle activity, no independent five-minute mutation denial, automatic client
expiry, foreground/back-forward revalidation and no-store responses.
