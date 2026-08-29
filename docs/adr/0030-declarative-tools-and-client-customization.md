# ADR-0030: Declarative tools, code-owned node kinds and client customization

- Status: Accepted (amended 2026-08-27 by [ADR-0035](0035-project-content-schema-dsl-and-collection-loop.md))
- Date: 2026-08-20
- Supersedes: None (extends [ADR-0005](0005-capabilities-and-manifests.md) and [ADR-0020](0020-code-owned-capability-catalog-and-project-binding.md))
- Superseded by: None

## Context

The first MVP ships one blog capability whose topology, prompts, models and Webbin-specific style are scattered across TypeScript literals. Before additional stacks and clients, Binflow needs a recognizable on-disk catalog of tools, per-node rules and model settings, a read-only dashboard visualization, and a safe way for each client to supply style and structure without inheriting Webbin's editorial look.

## Decision

1. **One tool per stack.** Each capability declares a single profile (for example `astro_repo`). Shared value lives in node kinds and shared rule documents, not in multi-profile tools.
2. **Repository catalog.** `@binflow/tools` owns `stacks/<stack>/<tool>/` with `tool.yaml`, `graph.yaml`, numbered `nodes/<nn>-<id>/node.yaml` (+ optional `rules.md`), and `customization-template.md`. Shared prose lives under `shared/rules/<name>@<version>.md`.
3. **Node kinds are code-owned.** Each kind has `kind` in `{compute, agent, effect, interrupt}`, typed I/O, optional `workload` (`text | embedding | image`), permissions, and adjustable parameter bounds. Predicates on conditional edges are code-owned identifiers, never expressions in YAML.
4. **Base model and effort live in `node.yaml`.** Skills and PRs edit them against a code-owned allowlist. The dashboard does not edit topology or base node config.
5. **Three rule layers.** (a) Contract/invariants in repo rules and deterministic validators. (b) Project structure from the immutable manifest. (c) Client style via a versioned markdown customization document per project and capability.
6. **Client customization.** Operators download the tool template, edit, and upload. Bodies are stored in the artifact store; `project_tool_customizations` is append-only and tenant-scoped. Customization is outside the enrollment manifest state machine so it can be updated without forcing full revalidation. Each run freezes the customization version. Customization is untrusted: it may supply style guidance and, when the tool template allows, an allowlisted declarative `## content_schema` YAML block of additional content fields (see [ADR-0035](0035-project-content-schema-dsl-and-collection-loop.md)). It cannot set model/effort, widen paths, skip approvals, execute code, or bypass code-owned schema compilation and publication guards.
7. **Dashboard.** Tools are listed by stack with a read-only graph view. A Customizations surface selects a client, lists assigned tools, and supports download template / download current / upload.
8. **Assignment.** Projects bind capabilities through immutable manifest revisions after activation (see binding generalization). Telegram `/tools`, `/help` and bot command menus derive from the effective catalog.

## Consequences

- Webbin-specific style must be extracted into Webbin's first customization document so other Astro clients start from a neutral template.
- Creating a tool requires a customization template; accepting customization without a template is invalid.
- Security documentation and threat model cover prompt-injection via uploaded markdown.
- Topology editing and an executable graph interpreter remain future work.

## Alternatives considered

- Multi-profile tools with per-stack graph variants: rejected as an extra dimension when one tool per stack is clearer.
- Per-node DB overrides for model/effort: rejected for MVP; base config stays in the repo and client variation is style markdown plus existing editorial manifest fields.
- Dashboard-as-editor for topology: rejected until node kinds and an execution engine can authorize composed graphs safely.
- LangGraph-compiled graphs: deferred per amended ADR-0004.

## Verification

Conformance tests keep declared graph stages aligned with executor checkpoints. Customization upload rejects unknown sections and oversized bodies. Generation uses composed rules; path/schema/approval guards remain enforced in code. Assignment and Telegram catalog tests cover multi-binding projects.
