# Impact matrix (new-stack)

Status values match
[`../../new-feature/references/impact-matrix.md`](../../new-feature/references/impact-matrix.md):
`compatible` | `docs_gap` | `rule_change` | `tool_risk`.

Present results using
[`../../new-feature/references/templates/impact-report.md`](../../new-feature/references/templates/impact-report.md).

## Stack-specific concerns (scan all)

| Concern | Read first | Typical status |
|---------|------------|----------------|
| ADR-0030 one tool ↔ one stack | `docs/adr/0030-*.md`, `packages/tools/README.md` | `docs_gap` |
| SCOPE / MVP / ROADMAP expansion | `SCOPE.md`, `MVP.md`, `ROADMAP.md` | `docs_gap` or `rule_change` |
| Profile enum / selectable enrollment | `CONTRACTS.md`, `packages/contracts` | `docs_gap` |
| Manifest / global profile stub | `ARCHITECTURE.md`, manifests package | `docs_gap` |
| Enrollment checks / empty catalog | `ONBOARDING.md`, `ENROLLMENT.md` | `docs_gap` |
| Dashboard profile select / tools filter | `DASHBOARD.md` | `docs_gap` |
| New provider / credential kind | `INTEGRATIONS.md`, `SECURITY.md` | `docs_gap` or `rule_change` |
| Telegram topology unchanged | `TELEGRAM.md`, ADR-0007 | `compatible` unless changing |
| ADR-0042 shared ports | ADR-0042 | `tool_risk` |
| Existing live stack tools | tool catalogs under `astro-repo` etc. | `tool_risk` / `compatible` |
| Worker / Telegram hot-load | `OPERATIONS.md`, `TELEGRAM.md` | usually `compatible` |
| First capability | create-tool later | handoff only — not this skill |
| Glossary terms | `GLOSSARY.md` | if new names |

## Tool / port scan (always)

1. List tools on **every** live profile that must not regress.
2. Name shared ports the future first tool might touch.
3. Confirm no plan to widen shared factory defaults.
4. Confirm enrollment-only ship does **not** create `packages/tools/stacks/<stack>/`
   unless the readiness handoff explicitly schedules a same-PR first tool
   (preferred: defer stack dir to create-tool).

## Freeze block (required in Impact Report)

State explicitly what must not change, e.g.:

- `astro_repo` / Webbin enrollment and existing capabilities
- Global admin Telegram bot topology
- ADR-0042 fail-closed shared port scopes
