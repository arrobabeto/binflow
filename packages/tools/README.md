# @binflow/tools

Declarative tool catalog grouped by stack. One tool binds to one stack.
Shared editorial prose lives under `shared/rules/`. Runtime topology remains
TypeScript-owned; this package is the source of truth for documentation,
validation, model/effort config, rule composition and dashboard visualization.

See [ADR-0030](../../docs/adr/0030-declarative-tools-and-client-customization.md).
Tool authoring pipeline: [ADR-0039](../../docs/adr/0039-tool-authoring-pipeline.md).
Astro Orbitype tools:
[implementation manual](../../docs/guides/astro-orbitype-tool-implementation.md)
and stack contract
[`.cursor/skills/create-tool/references/stacks/astro-orbitype.md`](../../.cursor/skills/create-tool/references/stacks/astro-orbitype.md).

- Briefs: `briefs/*.brief.yaml` (validated by `src/tool-brief.ts`)
- Scaffold: `pnpm exec tsx scripts/scaffold-tool.ts briefs/<id>.brief.yaml [--dry-run]`
