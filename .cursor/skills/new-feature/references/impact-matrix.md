# Impact matrix (Phase 2)

Use [`docs/README.md`](../../../../docs/README.md) ownership map as the source of
truth for which canonical file owns each concern. Fill
[`templates/impact-report.md`](templates/impact-report.md).

## Status values (exactly one per row)

| Status | Meaning |
|--------|---------|
| `compatible` | Documented behavior already allows this; maybe changelog only |
| `docs_gap` | Behavior is new or underspecified; need prose/spec/ADR |
| `rule_change` | Contradicts accepted ADR, SCOPE, SECURITY, MVP, or invariants |
| `tool_risk` | Shared port/runtime/graph may affect other tools (ADR-0042) |

## Concern → canonical doc (minimum scan)

| Concern | Read first |
|---------|------------|
| Product promise / users | `docs/PRODUCT.md` |
| In/out of scope | `docs/SCOPE.md` |
| MVP acceptance | `docs/MVP.md` |
| Roadmap phase | `docs/ROADMAP.md` |
| Services / trust boundaries | `docs/ARCHITECTURE.md` |
| Public types / API | `docs/CONTRACTS.md` |
| States / graphs | `docs/WORKFLOWS.md` |
| Threats / controls | `docs/SECURITY.md` |
| Entities / tenancy | `docs/DATA-MODEL.md` |
| Admin UI | `docs/DASHBOARD.md` |
| Enrollment / activation | `docs/ONBOARDING.md`, `docs/ENROLLMENT.md` |
| Bots / notifications | `docs/TELEGRAM.md` |
| Providers | `docs/INTEGRATIONS.md` |
| Tests / acceptance | `docs/TESTING.md` |
| Runtime / deploy | `docs/OPERATIONS.md` |
| Coding standards | `docs/DEVELOPMENT.md` |
| Durable decisions | `docs/adr/README.md` + relevant ADRs |
| Tool catalog | `packages/tools/README.md`, ADR-0030/0038/0039/0042 |
| Changelog | `docs/CHANGELOG.md` |

## Tool / port compatibility scan

Always answer:

1. Which `packages/tools/stacks/**` tools exist on the affected profile?
2. Which `executorId`s / `CapabilityRuntimeKind`s would touch shared code?
3. Would any shared factory gain a **wider default**? (Forbidden without opt-in —
   ADR-0042.)
4. Would Telegram copy, NL routing, or admin outbox be shared incorrectly across
   mutation classes?

List every affected tool id in the Impact Report even if status is `compatible`.

## Stack profile walkthrough (“enable a new stack”)

Use this when primary type is `stack_profile` (e.g. enable stack `X` / profile
`x_repo`).

| Concern | Typical status | Action |
|---------|----------------|--------|
| ADR-0030 one tool per stack / catalog layout | `docs_gap` or extend | ADR for profile `X` + stack path `packages/tools/stacks/<stack>/`; do not invent multi-profile tools |
| `docs/SCOPE.md` / `docs/MVP.md` | `docs_gap` or `rule_change` | If MVP only names `astro_repo`, expanding managed profiles needs SCOPE/MVP approval |
| `docs/ONBOARDING.md` | `docs_gap` | Enrollment steps, validation, activation evidence for the profile |
| `docs/ARCHITECTURE.md` | `docs_gap` | How the stack sits relative to API/worker/dashboard |
| Policies `allowedProfiles` / capability assignment | `docs_gap` | Registry + migration when first capability ships (create-tool / post-ship) |
| `projects.profile` enum / manifests | `docs_gap` | Manifest shape for the profile; rematerialize notes |
| ADR-0042 shared ports | `tool_risk` | If reusing GitHub catalog/OpenAI/Vercel: explicit scope per capability; no dual defaults |
| Existing `astro_repo` tools | `tool_risk` / `compatible` | Confirm create-blog/project/delete paths stay scoped; no shared port widen |
| First capability on the stack | handoff | After docs: create-tool for tool #1 — **not** this skill |

**Do not** create `packages/tools/stacks/<stack>/` files in new-feature. Document
the intended path and hand off.

## Capability-only shortcut

If primary type is `capability` on an **existing** profile, still scan ADR-0039,
ADR-0040 (if destructive), ADR-0042, and list sibling tools. Then hand off to
create-tool after Phase 4 (short spec + impact report may suffice).
