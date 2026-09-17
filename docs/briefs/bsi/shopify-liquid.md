# BSI implementer brief — `shopify-liquid`

Paste this brief when building or retrofitting a **Shopify Online Store 2.0**
theme (Liquid + JSON) for Binflow.

Platform rules:
[Binflow Surface Inventory](../../guides/binflow-surface-inventory.md) and
[Editable Surface Contract](../../guides/editable-surface-contract.md)
(ADR-0058 / ADR-0064). Shopify content tools already **read** BSI as the
allowlist (`edit_image_shopify`, `edit_text_shopify`).

| | |
|--|--|
| Catalog stack | `shopify-liquid` |
| Profile | `shopify_liquid` |
| Stack tool contract | `.cursor/skills/create-tool/references/stacks/shopify-liquid.md` |
| Product-shaped brief (beverage Home+blog) | [shopify-beverage-theme-agent-brief.md](../shopify-beverage-theme-agent-brief.md) |

**Note:** For this stack, missing/empty inventory fails closed for image/copy
Shopify tools. Still use the same BSI vocabulary as other stacks.

## Source of truth

- Allowlisted marketing fields: **GitHub theme** (`publication_target:
  github_theme`) — section settings, locale keys, assets.
- Native Articles: `catalog_bound` → `shopify_admin_articles` (future Admin
  ports; not storefront `edit_text`).
- Inventory path: `binflow/surface-inventory.yaml` (or manifest override).

## Must

1. Commit complete BSI for every `copy` / `style_target` / `image` Binflow
   should edit; encourage `chrome_denied` / `catalog_bound` / `container` rows
   for QA.
2. Markers on rendered nodes:

```html
data-bf-id="home.hero.heading"
data-bf-kind="copy"
data-bf-section="hero"
```

Background on a section/div:

```html
data-bf-id="home.hero.background"
data-bf-kind="image"
data-bf-section="hero"
data-bf-presentation="background"
```

3. Setting ids (snake_case schema):
   - Copy/style: `heading`, `subheading`, `body`, `description`, `text`,
     `intro`, `lead`, `paragraph`, `caption`, `eyebrow`
   - Images: `image`, `image_mobile`, `background_image` + `image_alt`
   - Chrome: `button_label`, `button_url`, `cta_*`, `link_*` → `chrome_denied`
4. Locators like `settings.heading`, `settings.background_image`; `path` =
   section/snippet Liquid file.
5. Unique default/`sample` strings (no eight identical “Learn more”).
6. Namespace CSS: `.home-*`, `.bf-surface-*`; no bare global `h1`/`a` from
   custom Home CSS.
7. Keep `style_target` in a single text node when possible.

## Must not

1. Do not scrape markers as the primary allowlist at tool search time —
   inventory YAML is the allowlist; remap refreshes YAML (ADR-0061).
2. Do not put marketing copy only in CSS `content:` without an inventory row.
3. Do not mix CTA labels into `copy` settings.
4. Do not invent parallel tag systems.
5. Product/collection Admin fields stay `catalog_bound` — not `edit_text`.

## Declare-only / forward kinds

- `container` — section shell (e.g. `home.hero.shell`)
- `video`, `overlay`
- `presentation: background` for CSS backgrounds (identify now; tool mutation
  follows inventory-aware image work)

## Example inventory rows

```yaml
version: 1
project_key: example-shop
surfaces:
  - bf_id: home.hero.shell
    kind: container
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: section
    locales: [es]
    publication_target: github_theme
    sample: ""

  - bf_id: home.hero.heading
    kind: copy
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: settings.heading
    locales: [es]
    publication_target: github_theme
    sample: "Unique default heading for disambiguation"

  - bf_id: home.hero.background
    kind: image
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: settings.background_image
    locales: [es]
    publication_target: github_theme
    presentation: background
    sample: assets/home/hero-bg.jpg
    alt_locator: settings.image_alt

  - bf_id: catalog.article.title
    kind: catalog_bound
    area: blog
    section: article
    path: templates/article.json
    locator: article.title
    locales: [es]
    publication_target: shopify_admin_articles
    sample: ""
    deny_reason: "Native Shopify Article title"
```

## Greenfield checklist

- [ ] `binflow/surface-inventory.yaml` for Home + blog chrome
- [ ] Markers on all declared surfaces; containers/backgrounds where used
- [ ] Setting ids follow naming rules; CTAs `chrome_denied`
- [ ] Assets under Home/blog namespaces; alts siblings
- [ ] Remap / push-gate awareness ([surface-inventory-sync](../../guides/surface-inventory-sync.md))

## Retrofit checklist (existing theme)

- [ ] Inventory rows for every slot `edit_text_shopify` / `edit_image_shopify`
      must hit
- [ ] Markers added without Theme Editor–only drift for allowlisted Git fields
- [ ] Unique samples backfilled where substring search fails
- [ ] Deep search / remap documented for operators (images)

## Related product brief

For a beverage Home + blog build with file isolation and exclusions, also use
[shopify-beverage-theme-agent-brief.md](../shopify-beverage-theme-agent-brief.md)
(points at this BSI stack brief for vocabulary).
