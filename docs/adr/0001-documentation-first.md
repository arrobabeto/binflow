# ADR-0001: Documentation-first delivery

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None

## Context

Binflow coordinates security-sensitive, multi-system mutations. If requirements, policies and runtime behavior exist only in code or conversation, later capabilities can silently weaken approval, tenant or recovery guarantees.

## Decision

Canonical documentation and ADRs precede implementation. Every code, configuration, schema, infrastructure, feature, security or scope change updates affected documentation and `docs/CHANGELOG.md` in the same PR. A stale document means the change is incomplete.

## Consequences

- Review begins with intended behavior and boundaries.
- Documentation work is part of estimates and Definition of Done.
- Accepted ADR history is preserved rather than rewritten.
- CI will eventually enforce documentation impact mechanically.

## Alternatives considered

- Document after implementation: rejected because drift would be expected.
- Rely on code/tests only: rejected because product intent and trust boundaries are not fully expressible there.

## Verification

Repository instructions, PR template and CI documentation checks require affected docs and changelog updates.
