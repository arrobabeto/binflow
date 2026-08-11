# ADR-0004: LangGraph workflows and BullMQ transport

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

Workflows require durable checkpoints, human interrupts, revisions and node-level retries. Webhook handlers also need asynchronous delivery and concurrency control.

## Decision

LangGraph.js owns workflow topology, checkpoints, interrupts and node retry policy. BullMQ transports idempotent start/resume signals and schedules maintenance; it does not independently retry business nodes. Each request has a stable LangGraph thread ID.

## Consequences

- Workflow state and queue delivery responsibilities are explicit.
- Graph/node versions are code-owned and frozen per request.
- BullMQ jobs use stable graph-run IDs and reconciliation before redelivery.
- Dashboard is not a visual graph editor in the MVP.

## Alternatives considered

- BullMQ-only orchestration: rejected because human pause/resume and graph state would be reimplemented.
- Provider-managed agent loop: rejected because authorization and durable state must remain application-owned.

## Verification

Restart, duplicate-job and approval-interrupt tests prove that only the expected node resumes.
