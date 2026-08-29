# <Title> — capability specification

Capability id: `<id>@<version>`
Stack: `<stack>`
Executor: `<executorId>`
Command: `<command>`
Graph: `<graphVersion>`
Mutation class: `<create|update|destructive|read_only>`

Canonical decision: [ADR-NNNN](../adr/....md).
Layer tags: `[CODE]`, `[MANIFEST-*]`, `[CUSTOMIZATION]`.

---

## 1. Three layers

Map each behavior to code, manifest, or customization (`layers.md`).

## 2. Content contract

Manifest paths, bundle shape, tombstone rules.

## 3. Capability inputs `[CODE]`

Zod input union modes in `packages/contracts/src/index.ts`.

## 4. Graph pipeline `[CODE]`

### Graph semantics

For each node, document **what happens** when the dashboard graph is read aloud:

| node.id | nodeKind | Meaning |
|---------|----------|---------|
| … | … | … |

Align ids with `graph-by-mutation.md` for the mutation class.

## 5. Client-facing messages

Per `client-facing-copy.md`:

### Plan confirm (Telegram)

- Locales: `es`, `en`, `de`
- Fields shown: title, URL, …
- Fields **never** shown: repo paths, SHAs, UUIDs

### Admin / outbox

- Client key, natural action line, PR URL, request id, dashboard path

### Inline CTAs

Per `client-facing-copy.md` — document every decision surface:

| Surface | action | es | en | de |
|---------|--------|----|----|-----|
| Plan confirm | confirm_plan | … | … | … |
| … | … | … | … | … |

Labels must match mutation class; destructive tools must not use create-draft wording.

## 6. Typed validation errors `[CODE]`

## 7. Pilot manifest `[MANIFEST-WEBBIN]` (if applicable)

## 8. Stack rollout

Per `post-ship-ops.md`:

1. Migration number + `pnpm db:migrate` before assignment
2. Default binding in `astroRepoDefaultCapabilityBindings` (if `astro_repo`)
3. Rematerialize script (if `editablePaths` changed)
4. Pilot customization upload script (if Webbin)

## 9. Verification

Scenario matrix + NL ingress test phrases per locale.
