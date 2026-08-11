# Product definition

## Product

Binflow is a private, AI-assisted WebOps control plane. Authorized clients and administrators request bounded website changes through Telegram. Binflow interprets the request, applies deterministic policy, creates a typed and versioned draft, produces an exact preview, collects approvals and publishes through the website's existing source of truth.

Binflow is not a general coding agent, a CMS replacement or a natural-language shell.

## Problem

Small but frequent content changes require clients to understand a CMS, repository, branch, deployment and validation process. Developers repeatedly reconstruct project-specific rules and manually coordinate previews and approvals. Existing automation is commonly embedded in personal scripts or agent skills and is not safe or observable enough for client self-service.

## Outcomes

### Administrator

- Enroll and validate clients without manually editing application data.
- Register project contracts, integrations, credentials and capabilities.
- Observe every request, graph run, model call, preview, approval and publication.
- Receive Telegram notifications for all client requests and decisions needing admin authority.
- Retain control of structural, high-risk and unsupported work.

### Client

- Request allowed changes using natural language or explicit commands.
- Understand required inputs and current project choices before generation.
- Review the real result rather than an abstract text response.
- Request revisions without losing history.
- Publish approved low/medium-risk content without learning GitHub or Vercel.

### Platform

- Convert project knowledge into versioned manifests, policies and executors.
- Preserve the repository or CMS as the source of truth.
- Make every mutation attributable, reproducible and recoverable.
- Add new technical profiles without weakening existing isolation or approval rules.

## Users and roles

First MVP:

- `platform_owner`: authenticates in the dashboard, configures tenants/projects and can act across tenants.
- `client`: one paired Telegram identity for one tenant/project/client bot.

Later roles may include administrator, developer, client owner, editor, reviewer and viewer. Role expansion must not change first-MVP permissions implicitly.

## Product principles

1. Telegram is an interface, not an authority boundary.
2. The LLM interprets and generates; application code authorizes and executes.
3. Every mutation uses a registered, typed capability.
4. Every mutation becomes a draft before production.
5. Every mutable version has an exact preview.
6. Approval binds to the exact artifact reviewed.
7. GitHub or the CMS remains the source of truth.
8. Policies live in code/data, not only in prompts.
9. External operations are idempotent and auditable.
10. Every integration follows least privilege.
11. Generated rationales describe decisions without claiming to expose private chain-of-thought.
12. Documentation and implementation are one deliverable.

## Product language

- Administrative dashboard: English only in the MVP.
- Client conversation locale: English, Spanish or German.
- Project content locales: the intersection of Binflow-supported locales and the project's manifest.
- Adding another client-facing language is a scope expansion requiring contracts, UI messages, tests and documentation.

## Commercial posture

The first releases are private and administrator-enrolled. There is no public registration, self-service billing, internal credit balance or public marketplace. Commercial packaging is deliberately separated from technical usage tracking.

## Success measures

- Percentage of allowed requests completing without developer intervention.
- Time from request to confirmed plan, preview and production.
- Revision count before approval.
- Build, preview and production verification success rate.
- Unauthorized or cross-tenant operations: zero.
- Publications whose approved version differs from production: zero.
- Cost per request/capability/client.
- Percentage of implementation PRs with current canonical documentation: 100%.
