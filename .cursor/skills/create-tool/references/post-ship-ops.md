# Post-ship operations

Run after scaffold + implementation, **before** declaring the tool done.

## 1. Database migration

```bash
pnpm db:migrate
```

Confirm row exists:

```sql
SELECT id, version, requires_preview, allowed_profiles
FROM capability_definitions
WHERE id = '<capability_id>';
```

**Never** toggle assignment in dashboard before migrate — returns
`capability_definition_missing` (400).

## 2. Append-only capability_definitions

Rows are **immutable**. To change `requires_preview`, permissions, etc.:

1. Bump `identity.version` in brief + `tool.yaml`.
2. New migration: `INSERT … version N+1` (never `UPDATE`).
3. Bump bindings to `capabilityVersion: N+1` in policies and manifests.

## 3. Manual registry snippets

Paste scaffolder stdout into:

- `packages/contracts/src/index.ts`
- `packages/policies/src/index.ts` (`capabilityRegistry` + stack default binding)
- `packages/workflows/src/capability-runtimes.ts`
- `packages/workflows/src/capability-ingress.ts` (if Telegram / collection)

## 4. Stack default bindings

`allowedProfiles` = **eligibility** (which projects may assign the tool).

**Effective enablement** = `project_capability_bindings` on the active manifest.

For `astro_repo` pilot tools, add to `astroRepoDefaultCapabilityBindings` in
[`packages/policies/src/index.ts`](../../../packages/policies/src/index.ts):

```typescript
export const webbinMyToolCapabilityBinding: CapabilityBinding = Object.freeze({
  access: 'client_publish',
  capabilityId: 'my_tool_id',
  capabilityVersion: 1,
});
```

New enrollments materialize defaults automatically. **Existing clients** need
rematerialize or manual dashboard assignment.

## 5. Manifest rematerialize

When `editablePaths` or portfolio paths change in
[`packages/manifests`](../../../packages/manifests/src/index.ts):

- Fingerprint changes → enrolled projects need a bumped manifest.
- Use or adapt scripts under `packages/tools/scripts/refresh-webbin-manifest-*.ts`.
- Copy locale/budget/bindings from superseded manifest version.

## 6. Pilot customization (Webbin)

- `docs/customizations/webbin-<tool>.md`
- Upload script in `packages/tools/scripts/upload-webbin-*-customization.ts`
- Run upload against local DB after customization is written.

## 7. Catalog version resolution (ADR-0038)

Dashboard/API and workflow helpers resolve tools by id using the **latest
catalog version** when version is omitted. After bumping `tool.yaml` version:

1. Align `CapabilityDefinition.version` and stack default
   `capabilityVersion` in policies.
2. When inserting `request_versions`, store
   `<capability>Definition.version` — **never hardcode `capabilityVersion: 1`**.
3. Resolve graph via `graphVersionForCapability(capabilityId)` **without** a
   default of `1`. Passing an explicit stale version (e.g. `@1` after bump to
   `@2`) throws `Unknown tool <id>@1` on plan confirm.
4. Rebuild `@binflow/tools` + `@binflow/workflows` and restart API/worker.

```typescript
// Good — latest catalog tool
await graphVersionForCapability('delete_blog_draft');
await getTool('delete_blog_draft');

// Bad — forces missing catalog row after version bump
await graphVersionForCapability('delete_blog_draft', 1); // or default param = 1
capabilityVersion: 1, // hardcoded on every request_versions insert
```

Symptom if missed: Telegram confirm fails with
`DomainError: Unknown tool <id>@1` in the worker.

## 8. Verification smoke

```bash
pnpm --filter @binflow/tools test
pnpm --filter @binflow/workflows test
pnpm db:migrate
# Dashboard: Tools → graph loads, assignment works for compatible profile
# Telegram: command + NL smoke per TELEGRAM.md scenarios
```

## Not automatic (product follow-up)

Assigning a new tool to **all existing clients of a stack** without rematerialize
or per-client toggle requires a dedicated operator job or ADR — not implied by
scaffold alone.
