# ADR-0010: Local-first, VPS-ready delivery

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

The MVP should prove the complete Webbin workflow before committing to a production host, while avoiding a local architecture that must be rebuilt for VPS deployment.

## Decision

Accept the MVP locally with real OpenAI, GitHub, Vercel and Telegram integrations. From Phase 0, every deployable service is packaged in Docker and the repository ships local Compose, production Compose, Caddy and runbooks concurrently. The same versioned application images are used locally and on the VPS; only configuration, secret delivery, ingress and operational sizing differ. Defer VPS provisioning and operational cutover to hardening. Local Telegram uses polling; production uses webhooks.

## Consequences

- External behavior is real even when the control plane is local.
- Public webhook availability is not required for initial development.
- Provider reconciliation must support webhook gaps.
- Production readiness artifacts exist before production operations are claimed.

## Alternatives considered

- Deploy VPS before E2E: rejected because it adds operations before product-loop validation.
- Local-only design: rejected because later runtime drift would be substantial.
- Serverless-first deployment: rejected because the selected durable worker/VPS model is deliberate.

## Verification

An empty-machine local setup completes E2E, production images build, Compose validates and runbooks identify all remaining cutover steps.
