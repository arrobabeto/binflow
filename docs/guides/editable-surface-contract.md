# Editable Surface Contract

Profile-agnostic, **site-first** contract for content that Binflow capabilities
may mutate. Binding decision: [ADR-0058](../adr/0058-editable-surface-contract.md).
Short definitions also live in [GLOSSARY.md](../GLOSSARY.md).

Stack-specific path builders, CMS schemas, preview ports, and approval graphs
remain owned by each profile (`astro_repo`, `astro_orbitype`, future Shopify,
etc.). This guide defines the **shapes and vocabulary** sites must expose so
tools discover intent instead of guessing field names.

## Why site-first

Historically, tools were built on finished sites (Orbitype sections, path
globs, denylists). That produced fragile heuristics. New sites intended for
Binflow declare an **Editable Surface** and a **Surface Inventory** before the
first capability ships. Discovery then reads the inventory (and markers) rather
than scraping for accidental allowlist matches.

```text
Figma → agent brief → site repo + Surface Inventory
  → project manifest editablePaths / bindings
  → capabilities (edit_text, edit_text_style, edit_image, blog, …)
  → draft → preview → approval → publish
```

## Core concepts

| Term | Meaning |
|------|---------|
| **Editable Surface** | Versioned set of fields Binflow may mutate for one project |
| **Surface Inventory** | Machine-readable map of every declared field (see schema below) |
| **bf_id** | Stable dotted id, e.g. `home.hero.heading`; never rename after ship |
| **field kind** | `copy` \| `style_target` \| `image` \| `chrome_denied` \| `catalog_bound` |
| **Publication target** | Where truth lives for a row (GitHub path, Shopify Admin Article, Orbitype page, …) — declared per stack |

### Field kinds

| Kind | Binflow treatment | Typical capability family |
|------|-------------------|---------------------------|
| `copy` | Atomic prose; **whole-field** literal replace | `edit_text` |
| `style_target` | Text node eligible for typographic wrap (excerpt + style marker) | `edit_text_style` |
| `image` | Replaceable asset slot (not logo/nav by default) | `edit_image` |
| `chrome_denied` | Visible UI chrome (CTA label/URL, nav, footer, aria); not body copy tools | none / specialized later |
| `catalog_bound` | Native catalog objects (product title/price, collection title, article title/body from Admin) | not storefront `edit_text` |

A single visual element must not mix kinds in one setting value (no HTML blob
that is both heading and button).

## Naming rules

**Prefer these setting / key ids for `copy` and `style_target`:**

`heading`, `subheading`, `title`, `body`, `description`, `text`, `intro`,
`lead`, `paragraph`, `caption`, `eyebrow`

**Reserve for `chrome_denied` (never reuse copy names):**

`button_label`, `button_url`, `cta_label`, `cta_url`, `cta_*`, `link_*`,
`nav_*`, `menu_*`, `aria_label`

**Images (`image` kind):**

`image`, `image_mobile`, `background_image` — always pair with sibling
`image_alt` (metadata; not body `copy` unless the inventory explicitly says so).

**bf_id namespace:**

```text
{area}.{section}.{field}

home.hero.heading
home.story.body
blog.listing.intro
blog.article.related_heading
```

Rules: lowercase; dot-separated; no spaces; stable forever; unique per project
surface.

## Markup markers (storefront HTML)

Where the site renders HTML for an inventory row of kind `copy`,
`style_target`, `image`, or `chrome_denied`, emit:

| Attribute | Value |
|-----------|--------|
| `data-bf-id` | Exact inventory `bf_id` |
| `data-bf-kind` | `copy` \| `style_target` \| `image` \| `chrome_denied` |
| `data-bf-section` | Short section token (`hero`, `story`, `listing`, …) |

`catalog_bound` nodes may omit markers or set `data-bf-kind="catalog_bound"`
for QA only; storefront copy tools must not patch them.

Style wraps applied by Binflow may add `data-binflow-style="1"` on a span
(existing Orbitype style tool). Keep `style_target` copy in a **single text
node** when possible so excerpt matching stays deterministic.

## CSS / isolation

- Namespace Home and marketing surfaces: `.home-*`, `.bf-surface-*`.
- Prefer CSS variables under a surface root (e.g. `.custom-home`) for type
  tokens (`--home-heading-size`, `--home-body-size`, …).
- Do **not** style bare `h1`, `p`, `button`, `a` globally from Home CSS.
- Do not put marketing copy only in `content:` CSS or SVG text without an
  inventory row and a Git-backed source.

## Storefront vs blog

### Storefront (marketing / Home)

- Authority for allowlisted marketing fields: **Git** (theme files, locale
  keys, section settings committed in repo) unless a stack ADR says otherwise.
- Isolate custom Home to `home-*` sections/assets and `home.*` locale keys when
  on Shopify Liquid (see project briefs).
- Product cards may show catalog data (`catalog_bound`) beside marketing chrome
  (`copy` / `image` for section heading, badge text, etc.).

### Blog / editorial

- **Post title, body, excerpt, featured image** are typically
  `catalog_bound` to the CMS or commerce Admin (e.g. Shopify Articles). Future
  blog capabilities publish through that Admin/CMS port, not by rewriting
  article HTML in the theme.
- Theme owns **templates and sections** that render those objects, plus
  **listing chrome** (`blog.listing.intro`, empty states, related headings) as
  `copy` / `image` with `bf_id`s under `blog.*`.
- Article templates must expose clear regions for production verification
  (featured image slot, title, body container) so `verify_production`-class
  nodes can assert visibility after publish.

### Explicit non-surfaces

Unless a project brief requires them:

- Restaurant **menu** PDF / menu CTA tools (`update_menu`)
- Mutating **product** or **collection** catalog fields via Admin as if they
  were `edit_text` targets

## Surface Inventory artifact

Commit at repo root (or documented path):

```text
binflow/surface-inventory.yaml
```

### Schema (YAML)

```yaml
version: 1
project_key: example-shop   # optional human key; enrollment may override
surfaces:
  - bf_id: home.hero.heading
    kind: copy
    area: home
    section: hero
    # Repo-relative path that owns the value (Liquid setting, locale key file, CMS mirror, …)
    path: sections/home-hero.liquid
    locator: settings.heading   # schema id, locale key, JSON pointer, …
    locales: [es]               # enrolled content locales this row applies to
    publication_target: github_theme
    sample: "Unique default heading for disambiguation"
    notes: ""                   # optional

  - bf_id: home.hero.image
    kind: image
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: settings.image
    locales: [es]
    publication_target: github_theme
    sample: "assets/home/hero.jpg"
    alt_locator: settings.image_alt

  - bf_id: home.hero.button_label
    kind: chrome_denied
    area: home
    section: hero
    path: sections/home-hero.liquid
    locator: settings.button_label
    locales: [es]
    publication_target: github_theme
    sample: "Shop now"
    deny_reason: "CTA label — not edit_text"

  - bf_id: blog.listing.intro
    kind: copy
    area: blog
    section: listing
    path: sections/blog-listing-hero.liquid
    locator: settings.body
    locales: [es]
    publication_target: github_theme
    sample: "Stories from the cellar"

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

### Inventory rules

1. Every `copy`, `style_target`, and `image` row Binflow should edit must appear.
2. `chrome_denied` and `catalog_bound` rows are encouraged for clarity and QA.
3. Default / sample strings for `copy` should be **unique enough** for substring
   targeting (avoid eight identical “Learn more” copy fields).
4. `bf_id` values are API contracts: renaming requires a new id and inventory
   migration notes, not silent edits.
5. `publication_target` values are stack vocabulary (`github_theme`,
   `shopify_admin_articles`, `orbitype_pages`, …); unknown targets fail closed
   at tool authoring time.

## Mapping to capability families

| Family | Inventory kinds used | Notes |
|--------|----------------------|-------|
| `edit_text` | `copy` | Whole-field replace; denylist = everything else |
| `edit_text_style` | `style_target` (or `copy` marked style-eligible) | Excerpt wrap; prefer single text node |
| `edit_image` | `image` | Deny logo/nav/`chrome_denied` image slots |
| Blog create / delete | `catalog_bound` article fields + theme chrome | Theme templates ready; Admin/CMS is source for posts |
| `update_menu` | n/a | Not part of this contract; project briefs may forbid |

Existing Orbitype/Webbin tools without an inventory keep heuristic discovery
(ADR-0058 grandfather). New stacks **should** seed manifests from the
inventory.

## PR checklist (site builds)

- [ ] `binflow/surface-inventory.yaml` committed and complete for Home + blog chrome
- [ ] Every editable node has `data-bf-id` / `data-bf-kind` / `data-bf-section`
- [ ] Copy setting ids follow naming rules; CTAs are `chrome_denied`
- [ ] Images namespaced under Home/blog assets; alts are siblings
- [ ] CSS namespaced; no global element selectors from custom Home CSS
- [ ] Blog article/listing templates render native article objects with clear verify hooks
- [ ] No menu-surface work unless the project brief explicitly requires it
- [ ] Document whether Theme Editor / CMS UI edits are discouraged for allowlisted Git fields

## Related documents

- [ADR-0058](../adr/0058-editable-surface-contract.md)
- [GLOSSARY.md](../GLOSSARY.md)
- [briefs/shopify-beverage-theme-agent-brief.md](../briefs/shopify-beverage-theme-agent-brief.md)
- Stack tool contracts under `.cursor/skills/create-tool/references/stacks/`
