# ADR-0008: Per-client OpenAI credentials

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

The first MVP needs structured interpretation, research, generation, translation, embeddings and images. Cost ownership and credential isolation must be explicit.

## Decision

OpenAI is the only active first-MVP AI provider. Every tenant supplies its own API key through SecretsProvider. Node model selection remains provider-neutral/configurable, but there is no silent global fallback. Missing, revoked or unavailable credentials block dependent nodes and notify the admin.

## Consequences

- Usage and provider billing remain attributable to the client.
- Onboarding must test all configured node workloads/model access.
- Provider abstraction remains mandatory for later Anthropic/other support.
- Global credential grants are a later product feature with separate policy.

## Alternatives considered

- Platform key for all clients: rejected for first MVP because cost/risk are pooled.
- OpenAI and Anthropic simultaneously: deferred to reduce initial contract/testing surface.
- Hardcoded model IDs in executors: rejected because model availability and cost change.

## Verification

Credential revocation tests block subsequent nodes without leaking the key or selecting a hidden fallback.
