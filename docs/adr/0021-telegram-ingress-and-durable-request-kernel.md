# ADR-0021: Telegram ingress and durable request kernel

- Status: Accepted
- Date: 2026-08-18

## Context

The MVP needs two Telegram bots and resumable client requests without allowing
channel text, Redis or an LLM to become an authorization boundary.

## Decision

1. A transport-neutral `@binflow/workflows` application service owns pairing,
   intent routing, request versioning, confirmation, cancellation and status.
2. PostgreSQL owns identities, conversations, requests, immutable request
   versions, action tokens, graph runs and checkpoints. BullMQ carries only a
   stable request-version resume signal; losing Redis does not lose workflow
   state.
3. Telegram adapters resolve the active bot credential before accepting an
   update. Client identity is resolved by bot ID plus numeric Telegram user ID.
   Message text never selects a tenant or project.
4. `/tools`, `/create_blog`, `/status`, `/cancel`, `/help` and natural-language
   routing use only active manifest capability bindings. The first router is
   deterministic and schema constrained; a later model classifier may propose
   an intent through the same contract but cannot authorize it.
5. Pairing tokens are random, hashed, bot/user/project scoped, expire after 24
   hours and are consumed exactly once. Opaque action tokens are hashed,
   version-bound and single-use.
6. Local bot transport uses independent polling runtimes and Redis namespaces.
   Production uses independent authenticated webhook routes. Neither path
   mutates Telegram webhook configuration during verification or startup.
7. Client-visible copy is complete in English, Spanish and German. No fallback
   mixes languages.

## Consequences

- Update replay, cross-bot user ID collision and stale actions cannot repeat a
  mutation.
- A workflow resumes after worker or Redis restart from the durable graph run
  and checkpoint.
- Module 7 stops at the confirmed `QUEUED` plan boundary. Module 8 implements
  the blog-generation and publication subgraph.

## Rollback

Stop Telegram/worker ingress first, restore the pre-`0013` database backup and
run the previous images. Do not run an older worker against the new schema.
