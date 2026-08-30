# Documentation checklist (Phase 4)

Complete after Phase 2 (and Phase 3 if required). Still **no product code**.

## Always

- [ ] `docs/specs/<slug>.md` from [`templates/feature-brief.md`](templates/feature-brief.md)
- [ ] Documentation impact block (canonical docs, ADRs, contracts/states,
      migrations, tests) inside the spec
- [ ] `docs/CHANGELOG.md` Unreleased entry
- [ ] Relative Markdown links verified

## By impact (check all that apply)

| If Impact Report touches… | Update |
|---------------------------|--------|
| Product promise / users | `docs/PRODUCT.md` |
| In/out of scope | `docs/SCOPE.md` |
| MVP boundary | `docs/MVP.md` |
| Delivery phase | `docs/ROADMAP.md` |
| Services / boundaries | `docs/ARCHITECTURE.md` |
| Types / API / errors | `docs/CONTRACTS.md` |
| States / graphs | `docs/WORKFLOWS.md` |
| Threats / controls | `docs/SECURITY.md` |
| Entities / retention | `docs/DATA-MODEL.md` |
| Admin UI | `docs/DASHBOARD.md` |
| Enrollment | `docs/ONBOARDING.md` |
| Bots / notices | `docs/TELEGRAM.md` |
| Providers | `docs/INTEGRATIONS.md` |
| Tests | `docs/TESTING.md` |
| Deploy / recovery | `docs/OPERATIONS.md` |
| Agent/dev workflow | `docs/DEVELOPMENT.md` |
| Terms | `docs/GLOSSARY.md` (only if new term) |
| Durable decision | `docs/adr/00NN-*.md` + `docs/adr/README.md` |
| Decision index | `docs/DECISIONS.md` when the project uses it for the ADR |

## ADR rules

- New durable decision → new ADR file; link supersession if replacing an older
  accepted ADR (do not silently rewrite history).
- Status `Proposed` until product owner accepts; skill may write `Accepted` only
  when the user approved in Phase 3 **and** the team convention is to land
  Accepted in the same docs PR (default for Binflow: mark **Accepted** after
  Phase 3 Approve).
- Do not invent ADR numbers that collide; next free number after scanning
  `docs/adr/README.md`.

## Stack profile extras

When primary type is `stack_profile`:

- [ ] Spec names stack directory and `projects.profile` value
- [ ] ONBOARDING/SCOPE mention the profile if managed onboarding expands
- [ ] Note that first tool uses create-tool + `allowedProfiles` migration
- [ ] ADR-0042 note if shared ports will be reused

## Explicitly out of Phase 4

- `packages/tools/stacks/**` scaffold
- `packages/db/migrations/**`
- Worker / API / dashboard application code
- Live provider calls

Those belong to create-tool or a later Agent implementation request.
