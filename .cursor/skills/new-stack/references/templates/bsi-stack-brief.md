# Template: BSI stack implementer brief

Write to `docs/briefs/bsi/<stack>.md` (hyphenated catalog stack id) and add a
row to `docs/briefs/bsi/README.md`.

Platform links (keep at top of the brief):

- [Binflow Surface Inventory](../../../docs/guides/binflow-surface-inventory.md)
- [Editable Surface Contract](../../../docs/guides/editable-surface-contract.md)

```markdown
# BSI implementer brief — `<stack>`

Paste this brief when building or retrofitting a **<stack human name>** site
for Binflow.

| | |
|--|--|
| Catalog stack | `<stack>` |
| Profile | `<profile>` |
| Stack tool contract | `.cursor/skills/create-tool/references/stacks/<stack>.md` |

**Opt-in / fail-closed:** <state whether missing BSI keeps heuristics or fails
closed for this stack’s content tools>.

## Source of truth

- <CMS / Git / Admin ports>
- `publication_target` values used on this stack

## Must

1. …
2. Markers: `data-bf-id`, `data-bf-kind`, `data-bf-section` (+ presentation)
3. Locators in **this** stack’s language
4. …

## Must not

1. …

## Declare-only

- `video`, `overlay`, `container`, `presentation: background` (unless tools already consume them)

## Markers / inventory examples

<code samples for this stack>

## Greenfield checklist

- [ ] …

## Retrofit checklist

- [ ] …
```
