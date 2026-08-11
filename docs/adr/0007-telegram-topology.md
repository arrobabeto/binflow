# ADR-0007: Admin bot plus dedicated client bots

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

Administrators need platform-wide notifications while clients need isolated, project-specific menus and conversations. A single shared client bot increases tenant-resolution and accidental-disclosure risk.

## Decision

Use one global admin Telegram bot and one dedicated client bot per enrollment. Both use a common `MessagingGateway`; each bot has separate credentials, state namespace and webhook/polling lifecycle. The first MVP activates one client bot but stores integrations generically.

## Consequences

- Bot identity is a tenant-resolution input for client traffic.
- Admin and client experiences can evolve independently.
- Local mode runs both through polling; production uses separate webhook secrets.
- Adding another messaging platform does not change domain request/approval contracts.

## Alternatives considered

- One bot for admin and clients: rejected due to broader blast radius and complex isolation.
- Admin dashboard only: rejected because mobile operational notification/approval is a core outcome.
- Custom Telegram-only domain types: rejected to preserve a platform-neutral messaging boundary.

## Verification

Tests route identical user/message IDs through different bot integrations and confirm isolation and role-specific behavior.
