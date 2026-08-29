# Tool audit reports

Persistent output from the [test-tool skill](../../.cursor/skills/test-tool/SKILL.md)
(client-realistic post-ship audits).

## Naming convention

```text
docs/audits/<toolId>[-<clientKey>]-<YYYY-MM-DD>.md
```

Examples:

- `delete_blog_draft-2026-08-28.md` — base catalog audit
- `delete_blog_draft-webbin-2026-08-28.md` — Webbin customized audit

## When to add a report

- After a `test-tool` run at `standard` or `deep` depth
- When closing a post-ship UX regression investigation
- Before promoting a customization to production

## What reports contain

See [`report-template.md`](../../.cursor/skills/test-tool/references/report-template.md):

- Parameters, pass rate, findings by layer (`code` / `manifest` / `customization`)
- Scenario matrix results (automated + live)
- Suggested preventive actions (tests, docs, skill antipatterns)

Reports are **not** a substitute for CI. They capture qualitative client-realistic
gaps that conformance tests may miss.

## Related docs

- [`docs/TESTING.md`](../TESTING.md) — required automated scenario matrix
- [`docs/adr/0039-tool-authoring-pipeline.md`](../adr/0039-tool-authoring-pipeline.md) — create-tool + test-tool pipeline
- [`docs/OPERATIONS.md`](../OPERATIONS.md) — stuck request recovery
