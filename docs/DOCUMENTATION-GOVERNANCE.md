# Documentation governance

## Policy

Documentation is part of the product and part of every deliverable. It is not a follow-up activity.

No application implementation begins until the baseline product, scope, architecture, security, contracts, workflows, testing, operations, and ADR documents are accepted. After implementation begins, every behavior-changing change updates documentation in the same PR.

## Change protocol

### Before implementation

1. Identify affected canonical documents using `docs/README.md`.
2. Write the intended behavior, constraints, failure modes and acceptance criteria.
3. Add an ADR when the change creates or reverses a durable architectural decision.
4. Review security, tenancy, permissions, data retention and operational impact.
5. Only then implement.

### Before completion

1. Update the canonical documents to match final behavior.
2. Update contracts, schemas, examples and state diagrams that changed.
3. Update testing and operational instructions.
4. Add a concise entry to `docs/CHANGELOG.md`.
5. Link added or superseded ADRs.
6. Verify all relative Markdown links.

## Documentation impact levels

| Change                           | Required documentation                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- |
| New feature/capability           | Product or scope, contracts, workflow, security, tests, roadmap and changelog   |
| Public API/schema/state change   | Contracts, data model, workflow, migration notes, tests and changelog           |
| Integration change               | Integrations, security, operations, tests and changelog                         |
| Infrastructure/deployment change | Architecture, operations, security, ADR and changelog                           |
| Internal refactor                | Changelog plus confirmation that behavior and architecture remain unchanged     |
| Bug fix                          | Affected canonical document, regression test description and changelog          |
| Scope expansion/reduction        | Product, scope, MVP/roadmap, ADR when durable, and changelog                    |
| Security fix                     | Security, threat/control mapping, operations when relevant, tests and changelog |

## ADR rules

- Use `docs/adr/0000-template.md`.
- Statuses: `Proposed`, `Accepted`, `Deprecated`, `Superseded`.
- Accepted ADRs are immutable except for typo/link corrections.
- Changed decisions require a new ADR that names the superseded ADR.
- ADRs contain context, decision, consequences, alternatives and verification.

## Enforcement

The initial repository rule is enforced through `AGENTS.md`, the PR template and review. A later CI documentation gate will require implementation PRs to change `docs/CHANGELOG.md` and at least one relevant document, with a documented escape hatch only for semantics-preserving documentation fixes.

## Style

- Write normative rules with **must**, **must not**, **should** and **may** deliberately.
- Prefer concrete behavior and examples over aspirational prose.
- Do not place secrets, customer-private content or unredacted provider payloads in documentation.
- Use stable domain terms from `GLOSSARY.md`.
- Date decisions and operational assumptions that may become stale.
