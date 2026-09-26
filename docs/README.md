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
12. [Client enrollment runbook](ENROLLMENT.md)
13. [Telegram experience](TELEGRAM.md)
14. [Integrations](INTEGRATIONS.md)
15. [Testing](TESTING.md)
16. [Operations](OPERATIONS.md)
17. [Development standards](DEVELOPMENT.md)
18. [Roadmap](ROADMAP.md)

## Guides

- [Agent skills](guides/agent-skills.md) — repo Cursor skills: description, scope, when to use
- [Binflow Surface Inventory (BSI)](guides/binflow-surface-inventory.md) — platform convention; opt-in rules; per-stack briefs (ADR-0058 / ADR-0064)
- [Editable Surface Contract](guides/editable-surface-contract.md) — `bf_id`, field kinds, inventory schema, markers
- [Surface inventory sync](guides/surface-inventory-sync.md) — push gate + remap / deep search freshness (ADR-0061)
- [Astro Orbitype tool implementation](guides/astro-orbitype-tool-implementation.md) — stack contracts, ports, manifest freeze, ops gates, failure appendix for `astro_orbitype` capabilities

## Briefs

- [BSI stack briefs](briefs/bsi/README.md) — implementer docs per catalog stack (`astro-repo`, `astro-orbitype`, `shopify-liquid`)
- [Shopify beverage theme agent brief](briefs/shopify-beverage-theme-agent-brief.md) — product-shaped Home + blog Liquid build (uses BSI Shopify brief)

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
| Operator enrollment step-by-step                | `ENROLLMENT.md`    |
| Bot interaction and notifications               | `TELEGRAM.md`      |
| External provider behavior                      | `INTEGRATIONS.md`  |
| Quality and acceptance strategy                 | `TESTING.md`       |
| Runtime, deployment and recovery                | `OPERATIONS.md`    |
| Coding and delivery standards                   | `DEVELOPMENT.md`   |
| Repo agent skills (Cursor)                      | `guides/agent-skills.md` |
| Delivery phases                                 | `ROADMAP.md`       |
| Site-first editable content vocabulary          | `guides/editable-surface-contract.md` |
| Binflow Surface Inventory (BSI)                 | `guides/binflow-surface-inventory.md` |
| BSI per-stack implementer briefs                | `briefs/bsi/` |
| Architectural decisions                         | `adr/`             |

When documents conflict, an accepted ADR wins for the decision it owns; otherwise the more specific canonical document wins. Resolve contradictions immediately rather than relying on tribal knowledge.
