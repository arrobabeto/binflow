# Binflow documentation

This directory is the canonical specification for Binflow. Documents describe current intended behavior; ADRs explain why durable decisions were made.

## Reading order

1. [Product definition](PRODUCT.md)
2. [Scope and boundaries](SCOPE.md)
3. [MVP definition](MVP.md)
4. [Architecture](ARCHITECTURE.md)
5. [Public contracts](CONTRACTS.md)
6. [Workflow model](WORKFLOWS.md)
7. [Security](SECURITY.md)
8. [Data model](DATA-MODEL.md)
9. [Admin dashboard](DASHBOARD.md)
10. [Dashboard design system](DESIGN-SYSTEM.md)
11. [Client onboarding](ONBOARDING.md)
12. [Telegram experience](TELEGRAM.md)
13. [Integrations](INTEGRATIONS.md)
14. [Testing](TESTING.md)
15. [Operations](OPERATIONS.md)
16. [Development standards](DEVELOPMENT.md)
17. [Roadmap](ROADMAP.md)

## Governance

- [Documentation governance](DOCUMENTATION-GOVERNANCE.md)
- [Decision log](DECISIONS.md)
- [ADRs](adr/README.md)
- [Changelog](CHANGELOG.md)
- [Glossary](GLOSSARY.md)
- [Technical references](REFERENCES.md)

## Canonical ownership map

| Concern                                         | Canonical document |
| ----------------------------------------------- | ------------------ |
| Product promise, users, outcomes                | `PRODUCT.md`       |
| In/out of scope                                 | `SCOPE.md`         |
| MVP acceptance boundary                         | `MVP.md`           |
| Services and trust boundaries                   | `ARCHITECTURE.md`  |
| Types, interfaces and API behavior              | `CONTRACTS.md`     |
| State machine and graph behavior                | `WORKFLOWS.md`     |
| Threats and controls                            | `SECURITY.md`      |
| Entities, tenancy and retention                 | `DATA-MODEL.md`    |
| Dashboard information architecture and behavior | `DASHBOARD.md`     |
| Dashboard visual tokens and UI patterns         | `DESIGN-SYSTEM.md` |
| Enrollment and activation                       | `ONBOARDING.md`    |
| Bot interaction and notifications               | `TELEGRAM.md`      |
| External provider behavior                      | `INTEGRATIONS.md`  |
| Quality and acceptance strategy                 | `TESTING.md`       |
| Runtime, deployment and recovery                | `OPERATIONS.md`    |
| Coding and delivery standards                   | `DEVELOPMENT.md`   |
| Delivery phases                                 | `ROADMAP.md`       |
| Architectural decisions                         | `adr/`             |

When documents conflict, an accepted ADR wins for the decision it owns; otherwise the more specific canonical document wins. Resolve contradictions immediately rather than relying on tribal knowledge.
