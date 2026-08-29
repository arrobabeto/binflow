# Verification rubric (Phase 4 scoring)

Score each scenario: **pass**, **fail**, **skip**, **unverified-live** (offline only).

## Dimensions

### Copy (client-facing)

| Pass | Fail |
|------|------|
| Title and URL shown in human form | Repo paths, branch names, SHAs in Telegram |
| Locale-appropriate strings | Mixed-locale buttons |
| Delete/update use capability-specific labels | Create CTAs on wrong surface (`Crear borrador` on delete) |
| Admin-pending destructive: text-only | GitHub PR inline buttons on client DM |

**Refs:** [`client-facing-copy.md`](../../create-tool/references/client-facing-copy.md)

### CTAs (inline buttons)

| Pass | Fail |
|------|------|
| Label describes **next** action | Generic confirm on wrong mutation |
| `callback_data` / action token matches handler | Token present but label misleading |
| Surface has at most one primary forward action | Conflicting approve + create labels |

Check: plan confirm, URL confirm, preview, revision plan, cancel (where allowed).

### State machine

| Pass | Fail |
|------|------|
| Terminal states match spec | Stuck `REVALIDATING`, `GENERATING` without progress |
| `FAILED_RETRYABLE` retries on provider errors | `FAILED_FINAL` on retryable provider errors |
| Re-delete aborts early | Opens second PR for gone article |
| Publish failure updates state + terminalResult | Silent stuck after failed publish |

### Graph (dashboard)

| Pass | Fail |
|------|------|
| Current node label matches activity | `open_deletion_pr` while failing at validate |
| Destructive graph has no `wait_preview` | Create nodes on delete tool |
| Checkpoints progress monotonically | Jump to `failed` without prior stage |
| `catalog_sync` declares `catalogScope` matching runtime | Missing scope or blog tool syncing portfolio |

**Refs:** [`graph-by-mutation.md`](../../create-tool/references/graph-by-mutation.md), ADR-0042

### Customization (customized mode only)

| Pass | Fail |
|------|------|
| Only collection asks differ from base | Custom text changes approval or paths |
| Required fields close predictably | Photo closes string fields incorrectly |
| Asks match uploaded markdown | Stale DB customization vs doc |

**Refs:** ADR-0030, [`layers.md`](../../create-tool/references/layers.md)

### Operations

| Pass | Fail |
|------|------|
| Migrate before assignment | Tool assigned but definition missing |
| Manifest rematerialized after path changes | Stale editablePaths after collection changes |
| Conformance suite green | Catalog/policy/registry drift |

**Refs:** [`post-ship-ops.md`](../../create-tool/references/post-ship-ops.md)

### Production verification (destructive)

| Pass | Fail |
|------|------|
| Old article URL returns 404 after merge | 200 on deleted article |
| Redirect Location apex/www equivalent | Wrong path (portfolio when home expected) |
| Catalog tombstone `deleted` | Item still `published` after merge |

## Severity guide (for findings)

| Severity | When |
|----------|------|
| **blocker** | Client cannot complete flow; data/publication risk |
| **major** | Wrong UX, stuck state, incorrect CTA, verify fail |
| **minor** | Copy improvement, missing test gap |
| **info** | Suggestion, doc drift, unverified-live note |

Every **fail** becomes a finding with **layer** (`code` / `manifest` / `customization`).
