# ADR-0042: Tool isolation and shared ports

- Status: Accepted
- Date: 2026-08-29
- Supersedes: None
- Superseded by: None

## Context

Declarative tools already isolate executors and runtimes
(`BlogWorkflowRuntime` vs `DeleteBlogWorkflowRuntime`). Graph `node.yaml` files
are also per-tool on disk. The remaining coupling is **shared ports**
(GitHub catalog, OpenAI, Vercel): widening a default for one capability can stall
or change another. The create-blog `catalog_sync` hang after delete-blog added
portfolio tree walks to the shared GitHub catalog factory is the reference
incident.

ADR-0039 covers authoring pipeline (brief → scaffold → conformance). It does
not define when to parametrize a shared node kind versus fork it, nor that
shared ports must be fail-closed on scope.

## Decision

1. **Three boundaries**
   - **Declarative graph** — what the operator sees (`node.id`, `nodeKind`,
     labels, `parameters`). Ids/kinds must reflect mutation semantics
     (ADR-0039 / graph-by-mutation).
   - **Executor family** — state machine and stages (`onStage` = `node.id`).
   - **Shared ports** — GitHub / OpenAI / Vercel only via factories that receive
     **capability-derived config**. Sharing implementation is fine; sharing
     unscopeed defaults is not.

2. **When to parametrize vs fork**

   | Situation | Action | Example |
   |-----------|--------|---------|
   | Same meaning and I/O, different scope | One `nodeKind` + declarative parameters | `content.catalog_sync@1` + `parameters.catalogScope: blog \| portfolio` |
   | Same label but different phase or side effects | Distinct `nodeKind` (and usually `node.id`) | Ingress persist vs execute ephemeral sync |
   | Different mutation / UX | Distinct `node.id` | `create_draft` vs `open_deletion_pr` |
   | Different business logic | Distinct executor family | `BlogExecutor` vs `DeleteBlogExecutor` |

3. **Catalog scope (binding for current tools)**
   - `createGitHubContentCatalogPort` requires non-empty `contentKinds`.
     There is no default of `['blog','portfolio']`.
   - Worker constructs catalog ports only through
     `createCapabilityCatalogPort` / `catalogContentKindsForRuntimeKind`
     (`blog` \| `delete_blog` → blog; `project` \| `delete_project` → portfolio).
   - Every `catalog_sync` node declares `parameters.catalogScope` matching that
     mapping. Conformance fails if missing or mismatched.

4. **Authoring gate**
   - Before changing shared port code, list which `executorId`s / runtime kinds
     pass through the call site. If more than one, the change must be opt-in
     per capability (parameters or explicit factory args), never a wider default.
   - create-tool checklist records shared-code impact; test-tool discovery
     checks `catalogScope` on tools that sync catalogs.

## Consequences

- New tools that sync content must declare `catalogScope` and register in
  `catalogScopeForRuntimeKind` (or an equivalent explicit map) before shipping.
- Future ingress/execute catalog splits may introduce a new `nodeKind` without
  changing scopes of existing `content.catalog_sync@1` tools.
- Operators still see one "Sync content catalog" label when semantics match;
  isolation lives in parameters and ports, not cloned node names alone.

## Alternatives considered

- Duplicate `catalog_sync` node ids per tool only by name: rejected for same
  meaning + same port; does not prevent shared-port scope creep.
- Capability `if` branches inside the GitHub package: rejected; centralize in
  the runtime registry / worker factory.
- Keep dual default and rely on worker discipline: rejected; the incident
  proved omissions reintroduce dual tree walks.

## Rollback

Restore optional `contentKinds` with dual default only after documenting a
superseding ADR. Prefer keeping fail-closed and fixing call sites.
