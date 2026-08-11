# ADR-0002: TypeScript/pnpm monorepo

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

API, workers, dashboard, schemas, workflows and integrations share contracts. The first managed stacks are primarily TypeScript-based.

## Decision

Use Node.js 24 LTS and a strict TypeScript monorepo managed by pnpm. Separate deployable apps from framework-independent domain/contracts and provider adapters. Fastify serves the business API; Nuxt serves the administrative dashboard.

## Consequences

- Schemas/types can be shared without copying wire contracts.
- API, worker and dashboard remain independently deployable.
- Provider SDK types must be normalized at adapter boundaries.
- Turborepo is optional and may be adopted only when build orchestration justifies it.

## Alternatives considered

- Split repositories: rejected for first-stage contract/version coordination cost.
- Python backend: valid technically but adds language and schema duplication for this team/context.
- Single Nuxt application: rejected because long-running workers and webhook API need independent scaling/lifecycle.

## Verification

CI confirms Node.js 24 and the pinned pnpm version, while dependency-boundary tests and package lint rules prevent domain packages from importing apps/provider frameworks.
