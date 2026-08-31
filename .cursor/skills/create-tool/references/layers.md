# Three-layer decision table

| Layer | Owns | Examples | Never |
|-------|------|----------|-------|
| **code** | Invariants, validation, state machine, ports | Zod schemas, executor stages, GitHub/Vercel calls, similarity checks, merge guards, `allowedProfiles` assignment gate | Client-specific prose, per-tenant paths |
| **manifest** | Per-project structure | Collection directories, `editablePaths`, frontmatter fields, enum labels, imageDirectory | Editorial voice, LLM prompts |
| **customization** | Per-client prose and optional `content_schema` | `generate` voice, section lengths, anonymization rules, Webbin field asks | Models, effort, paths, permissions, skipping approvals |

## Stack / profile compatibility

- Brief `identity.stack` / `identity.profile` and `migration.allowedProfiles` declare which project profiles may bind the tool.
- Load `references/stacks/<stack>.md` before interview (created by new-stack).
- Assignment (`PUT .../capabilities`) enforces `projects.profile ∈ allowed_profiles`.
- Dashboard Tools assignment only lists enrollments with matching `projectProfile`.
- Scaffolding registers the capability; operators enable it per compatible client after `pnpm db:migrate`.
- **Effective enablement** = manifest binding (`enabledCapabilities`), not profile alone. See `post-ship-ops.md`.

## Antipatterns (learned from create_project_astro and delete_blog)

1. **URL poisoning collection** — heuristics must close only the asked field; reject URL-like values in `string`/`stringList`.
2. **Cover path drift** — code force-sets AVIF `imagen` when hero screenshot provided; don't trust LLM `.jpg`.
3. **Graph version hardcode** — always read from `tool.yaml` via `getTool` (ADR-0038); omit version → latest catalog version.
4. **Fail-open worker** — unknown `executorId` must throw, not fall back to blog runtime.
5. **Destructive without platform** — deletion needs GitHub DELETE + PR + verify semantics + catalog tombstone (ADR-0040).
6. **Assign before migrate** — missing `capability_definitions` row → `capability_definition_missing` (400).
7. **Create nodes on delete graph** — `create_draft` / `wait_preview` on destructive tools; use `open_deletion_pr` instead. See `graph-by-mutation.md`.
8. **Repo paths in client copy** — plan confirm and Telegram must show title + URL, not file lists. See `client-facing-copy.md`.
9. **UPDATE capability_definitions** — append-only table; bump version + new INSERT migration.
10. **Preview on destructive** — `requiresPreview: false` unless an ADR explicitly documents Vercel preview for deletion.
11. **Generic CTAs across mutation classes** — reusing `localeCopy.confirm` ("Crear borrador") on destructive/update tools; labels must be per capability and decision surface. See `client-facing-copy.md` § Inline CTAs.
12. **Hardcoded capabilityVersion: 1** — after a catalog bump, `graphVersionForCapability` / `getTool(id, 1)` and request_versions inserts must use the definition version or omit version for latest. Symptom: `Unknown tool <id>@1` on plan confirm. See `post-ship-ops.md` §7.
13. **Shared destructive client copy** — `renderDeleteAdminPendingNotice` / completion notices must pass `contentKind: 'blog' | 'portfolio'`; never reuse article wording for portfolio deletes.
14. **Shared port scope creep** — never widen a shared GitHub/OpenAI/Vercel factory default for one tool (ADR-0042). Catalog sync declares `parameters.catalogScope: blog | portfolio`; `createGitHubContentCatalogPort` requires non-empty `contentKinds` via `createCapabilityCatalogPort` / `catalogContentKindsForRuntimeKind`. If semantics or side effects diverge (ingress persist vs execute ephemeral), fork `nodeKind` / `node.id` instead of editing a shared kind for one tool only.
15. **Hardcoded client origin / paths in shared code** — never bake `webbin.com.mx`, `/articulos`, or one tenant’s CMS routes into shared Telegram guidance, delete production-origin helpers, or Vercel wait defaults. Resolve `deployment.productionOrigin` and route prefixes from the frozen manifest (ADR-0048). Webbin-only layouts belong in the `astro_repo` builder or customization markdown.
16. **Skip stack contract** — create-tool/test-tool must load `references/stacks/<stack>.md` (emitted by new-stack). Orbitype tools also follow `docs/guides/astro-orbitype-tool-implementation.md`.
17. **Stale Orbitype manifest** — after `editablePaths`, `routePrefix`, or `productionOrigin` changes, rematerialize and verify fields; treat rematerialize noop as failure if the field is still missing.
18. **Orbitype CMS invent columns / retry loops** — match real CMS schema; map SQL 4xx to `provider_final`; use stable recovery outbox keys.

## Destructive checklist (ADR-0040 gate)

Before catalog registration:

- [ ] GitHub DELETE via PR (no direct production delete).
- [ ] Post-merge verification decided: 404 vs **301 redirects** (do not assume 404).
- [ ] Catalog tombstone / index update in executor.
- [ ] Admin-only or documented approval policy.
- [ ] `requiresPreview: false` in brief, tool.yaml, policies, migration.
- [ ] Manifest `editablePaths` include redirect files when applicable + rematerialize script.
- [ ] Graph nodes renamed per `graph-by-mutation.md`.

## Customization sections

- Reserved: `content_schema` (DSL fields, not a node id)
- Other `##` headings must match node ids with `acceptsClientCustomization: true`

## Manifest fingerprint

Changing `editablePaths` or portfolio paths changes manifest fingerprint — plan rematerialize for enrolled projects (`post-ship-ops.md`).
