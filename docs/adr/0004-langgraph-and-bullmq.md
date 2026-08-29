# ADR-0004: TypeScript workflow runtime and BullMQ transport

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None
- Amended: 2026-08-20 (LangGraph deferred; runtime is TypeScript-owned)

## Context

Workflows require durable checkpoints, human interrupts, revisions and capability-level retries. Webhook handlers also need asynchronous delivery and concurrency control. An earlier draft of this ADR named LangGraph.js as the topology owner, but the Module 8 implementation ships a TypeScript orchestrator with append-only PostgreSQL checkpoints and does not depend on LangGraph.

## Decision

1. The TypeScript packages `@binflow/workflows` and capability executors (for example `@binflow/blog`) own workflow topology, stage checkpoints, human interrupts and retry classification.
2. BullMQ transports idempotent start/resume signals and schedules maintenance; it does not independently retry business nodes.
3. Each request version has a durable `graph_runs` row. Append-only `workflow_checkpoints` records stage identity and redacted summaries. Checkpoints are an audit and progress log; a retryable failure re-enters the current resume command (`execute` or `publish`) from the beginning rather than replaying from an arbitrary mid-stage checkpoint.
4. Human interrupts end the worker job after writing request state and issuing action tokens. Approval or revision enqueues a new resume job; there is no suspended coroutine.
5. LangGraph is not a runtime dependency. Adopting it would require a superseding ADR and a migration that preserves PostgreSQL as the durable source of workflow state.

## Consequences

- Workflow state and queue delivery responsibilities remain explicit.
- Graph and node configuration versions are code-owned (and, for client style, project-customization versioned) and frozen per request.
- BullMQ jobs use stable graph-run IDs and reconciliation before redelivery.
- The dashboard may visualize declared tool graphs as read-only documentation of the TypeScript topology; it is not a topology editor that invents executors.
- Documentation that previously referenced LangGraph checkpoint tables or LangGraph-owned interrupts is corrected to describe `workflow_checkpoints` and state-machine interrupts.

## Alternatives considered

- BullMQ-only orchestration: rejected because human pause/resume and graph audit would be reimplemented without a clear stage model.
- Provider-managed agent loop: rejected because authorization and durable state must remain application-owned.
- Immediate LangGraph adoption: rejected until a superseding ADR proves resume-from-checkpoint semantics without duplicating the existing approval, Telegram action-token and RLS model.

## Verification

Restart, duplicate-job and approval-interrupt tests prove that only the expected resume command runs and that approvals bind to the exact preview artifact.
