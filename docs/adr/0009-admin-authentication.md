# ADR-0009: Password and TOTP admin authentication

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

The dashboard manages client credentials, integrations, manifests and production approvals. Password-only access is insufficient; an external identity provider is unnecessary for the first private deployment.

## Decision

Use Better Auth with email/password, mandatory TOTP and backup codes. The platform owner is created through an explicit bootstrap process. Secret management and admin approvals require a completed two-factor session and may require recent reauthentication.

## Consequences

- Dashboard auth remains self-hosted and database-backed.
- Backup-code handling and clock health become operational concerns.
- Client users do not receive dashboard accounts in the first MVP.
- Later SSO must preserve role, MFA and audit semantics.

## Alternatives considered

- Password only: rejected due to secret/production authority.
- Magic link: rejected because email delivery would become a critical dependency.
- External auth provider: deferred until organizational requirements justify it.

## Verification

Tests cover bootstrap, TOTP enrollment/login, backup-code single use, session revocation and sensitive-action denial without 2FA.
