# ADR-0016: Platform-owner bootstrap and session assurance

- Status: Accepted
- Date: 2026-08-17
- Amended: 2026-09-26 (audited break-glass password recovery)
- Supersedes: None
- Superseded by: ADR-0024 for session duration and freshness timing

## Context

ADR-0009 selects Better Auth, password authentication, mandatory TOTP and backup
codes. The implementation also needs deterministic rules for creating the first
owner, preventing public enrollment, deciding when a session has sufficient
assurance and recovering access without adding email delivery to the MVP.

## Decision

- The first MVP permits exactly one platform-owner account.
- The account is created only by the interactive local command
  `pnpm binflow admin bootstrap`. Runtime HTTP sign-up is disabled. Bootstrap
  obtains a PostgreSQL advisory lock, refuses to run when an auth user already
  exists and never accepts or prints the password as a command argument.
- Passwords contain 12–128 characters. Better Auth owns password hashing and
  credential/session persistence; Binflow never implements password crypto.
- The owner may authenticate with a password only to reach `/security` and
  complete TOTP enrollment. All business and secret-management routes require
  `user.twoFactorEnabled = true` and a server-validated session.
- The initial false-to-true TOTP transition revokes every existing session for
  the owner before Better Auth issues the verified enrollment session. Other
  password-only sessions cannot inherit two-factor assurance retroactively.
- TOTP is the only online second factor. Trusted-device bypass is disabled by
  policy. Backup codes are shown only at enrollment/regeneration, are single-use
  and can complete the sign-in challenge.
- Database-backed sessions expire after 12 hours, refresh at most once per hour
  and use no cookie session cache. Better Auth session freshness is five minutes.
  Secret, integration, security and approval mutations require a fresh session;
  other authenticated operations require a non-expired two-factor session.
- Password reset email and public account recovery are absent. Break-glass
  recovery uses the interactive local command
  `pnpm binflow admin recover --email <existing-owner-email>`. It requires a
  current database backup and the database-owner connection, matches exactly
  one existing owner, changes only that owner's password, revokes all of that
  owner's sessions, and records an audit event in the same transaction. The
  password is entered twice through non-echoed prompts and follows the
  12–128-character bounds. Recovery preserves TOTP enrollment, never creates or
  replaces an owner, and refuses non-interactive use. TOTP replacement remains
  an explicit operator procedure rather than a browser self-service action.
- Auth rate limits use PostgreSQL so restart or horizontal-process changes do
  not erase counters. Production trusts forwarded client IP information only
  from the Caddy boundary; direct origin access remains unavailable.
- `BINFLOW_AUTH_SECRET` or `BINFLOW_AUTH_SECRET_FILE` supplies an independent,
  high-entropy Better Auth secret. It is not the credential-envelope KEK and is
  never committed or stored in PostgreSQL.

## Consequences

- Initial setup has an intentional two-step flow: CLI bootstrap, then browser
  TOTP enrollment.
- A database migration adds Better Auth and rate-limit tables; the auth package
  maps the generated schema explicitly instead of allowing runtime migrations.
- Fastify and Nuxt share the same server-side auth configuration. Nuxt alone
  exposes `/api/auth/**`; Fastify only resolves sessions for `/api/v1/**`.
- Losing every TOTP and backup factor requires host-level operator access and a
  documented audited recovery, which is acceptable for the private first MVP.

## Alternatives considered

- Public sign-up followed by promotion: rejected because it creates an account
  takeover and race window.
- A bootstrap token over HTTP: rejected because the local operator already has
  safer terminal access.
- Reusing the credential KEK as the auth secret: rejected because the keys have
  different lifecycles and compromise domains.
- Trusted devices: rejected for the first MVP because they weaken the explicit
  TOTP-on-every-login expectation.

## Verification

Tests cover single-owner bootstrap serialization, disabled HTTP sign-up,
password bounds, incomplete-TOTP route restriction, TOTP and backup-code login,
single-use backup codes, fresh-session gates, break-glass password rotation,
session revocation, TOTP preservation, origin checks, rate limiting and redacted
logs/errors.
