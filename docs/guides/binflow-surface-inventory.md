# Binflow Surface Inventory (BSI)

**BSI** is Binflow’s shared, **site-first** convention for declaring which parts
of a client site tools may identify and (when capabilities support it) mutate.

- **Public name:** Binflow Surface Inventory (**BSI**)
- **ADR synonym:** Surface Inventory ([ADR-0058](../adr/0058-editable-surface-contract.md))
- **Artifact:** `binflow/surface-inventory.yaml` + `data-bf-*` markup markers
- **Schema / vocabulary detail:** [Editable Surface Contract](editable-surface-contract.md)
- **Stack-specific implementer briefs:** [docs/briefs/bsi/](../briefs/bsi/README.md)
- **Governance:** [ADR-0064](../adr/0064-optional-bsi-astro.md) (general BSI +
  per-stack briefs; Astro opt-in clarified)

BSI is a **Binflow platform convention**, not a single-stack feature. Every
catalog stack has (or must get, via `new-stack`) its own technical BSI brief.
Language and locators differ by stack; the vocabulary (`bf_id`, kinds, markers)
does not.

## Why BSI exists

Without a declared map, tools scrape CMS field names, section indexes, or
Liquid setting ids. Reorders, renames, CSS background images on `div`s, CTAs,
and popups become invisible or fragile.

BSI declares intent once:

```text
{area}.{section}.{field}  →  kind  →  path/locator  →  publication_target
```

Markers on the rendered root node are a few static HTML attributes — **no**
client JS, **no** inventory fetch, **no** meaningful runtime cost.

## Opt-in rule (platform)

| Client site | Tool behavior |
|-------------|----------------|
| **No** BSI (no usable inventory) | Stack keeps its **current** discovery (heuristics / path globs / etc.) |
| **Has** valid BSI | Capabilities that know how to read inventory **prefer** BSI rows; incomplete/unreadable inventory falls back to current discovery |

**Enrollment:** Astro profiles (`astro_repo`, `astro_orbitype`) do **not** require
BSI to enroll or run. Shopify Liquid **content tools** (`edit_*_shopify`) already
fail closed without inventory for that stack — that is a stack/tool rule, not a
reason to invent a second labeling system.

Shipping BSI on a template is a product choice for greenfield sites; retrofits
are encouraged but not forced on grandfathered pilots (ADR-0058 / ADR-0064).

## Benefits

- Stable targets across CMS reorder and template refactors (`bf_id` never renames
  casually).
- Clear split: prose vs CTA chrome vs images vs catalog objects vs overlays.
- Background images on `div`/`section` are first-class (`presentation: background`).
- Section shells are identifiable (`kind: container`) without being copy fields.
- One vocabulary for agents building **any** Binflow-intended site.
- Future tools consume the same map instead of new ad-hoc denylists.

## Shared rules (all stacks)

1. **`bf_id`:** `{area}.{section}.{field}` — lowercase, dots, no spaces, unique
   per project, stable after ship.
2. **Kinds:** `copy` | `style_target` | `image` | `chrome_denied` |
   `catalog_bound` | `video` | `overlay` | `container`  
   (see [Editable Surface Contract](editable-surface-contract.md) for treatment).
3. **Markers** on the editable **root** node (or container shell):
   - `data-bf-id`, `data-bf-kind`, `data-bf-section`
   - optional `data-bf-presentation` = `img` | `background` | `picture` for images
4. **Copy vs chrome:** never reuse copy field names for buttons/links.
5. **Images:** pair with alt; CSS backgrounds are still `kind: image` with
   `presentation: background` on the painted element.
6. **Containers:** mark meaningful section/`div` shells (`home.hero.shell`); do
   not mark every layout wrapper.
7. **Unique samples** for substring targeting where tools search live text.
8. **No browser discovery** — inventory lives in Git; markers are static attrs.
9. **Do not invent parallel tag systems.**

Stack language (Liquid settings vs Orbitype props vs Astro content collections)
lives only in the **per-stack BSI brief**.

## Per-stack implementer briefs

Give agents **both** this guide and the brief for the target stack:

| Catalog stack | Profile | Implementer brief |
|---------------|---------|-------------------|
| `astro-repo` | `astro_repo` | [briefs/bsi/astro-repo.md](../briefs/bsi/astro-repo.md) |
| `astro-orbitype` | `astro_orbitype` | [briefs/bsi/astro-orbitype.md](../briefs/bsi/astro-orbitype.md) |
| `shopify-liquid` | `shopify_liquid` | [briefs/bsi/shopify-liquid.md](../briefs/bsi/shopify-liquid.md) |

When **`new-stack`** adds a profile, it **must** add `docs/briefs/bsi/<stack>.md`
and index it in [briefs/bsi/README.md](../briefs/bsi/README.md).

## Related

- [Editable Surface Contract](editable-surface-contract.md) — schema & inventory YAML shape
- [Surface inventory sync](surface-inventory-sync.md) — Shopify remap / freshness (ADR-0061)
- [DEVELOPMENT.md](../DEVELOPMENT.md) — when site-build agents should load BSI
- Stack tool contracts: `.cursor/skills/create-tool/references/stacks/`
