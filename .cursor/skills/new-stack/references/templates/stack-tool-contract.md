# Stack tool contract: `<stack>` / `<profile>`

Fill during **new-stack** Phase 3–4. Write the result to
`.cursor/skills/create-tool/references/stacks/<stack>.md` (hyphenated stack id)
and add a row to that folder’s `README.md`.

create-tool and test-tool **must** load this file before the first capability
on the stack. If the file is missing, those skills stop.

| Field | Value |
|-------|-------|
| Catalog stack | (hyphenated) |
| Project profile | (underscored) |
| Pilot / reference client | |
| Empty catalog at ACTIVE | yes / no |
| Required credentials | |
| Enrollment fields | (especially `productionDomain`, locales) |
| Implementation guide | path under `docs/guides/` if tools exist, else TBD |

## Path / route conventions

- Content paths / `editablePaths` shape:
- Preview / production route shape (`routePrefix`, CMS id/slug if any):
- Branch pattern:

## Production origin

- How `deployment.productionOrigin` is set (required vs pilot fallback):
- Worker / Vercel wiring notes:

## Ports / ADR-0042

- Publication ports:
- Catalog scope rules:
- Shared-factory freezes:

## Rematerialize triggers

List fields that force a manifest bump + verification that fields landed.

## Telegram / copy

- Origin/path rules for client-visible URLs:
- What may live only in customization:

## Live smoke gates

1. …
2. …

## Failure checklist (stack-specific)

| # | Check |
|---|--------|
| 1 | |

## Freeze vs existing stacks

What must not change on `astro_repo` / Webbin (or other live stacks).
