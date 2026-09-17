# Agent brief: Shopify beverage theme (Binflow-ready)

Paste this entire brief into the agent session that builds the Shopify theme.
**BSI (required vocabulary for this stack):**
[Binflow Surface Inventory](../guides/binflow-surface-inventory.md) +
[BSI implementer brief — shopify-liquid](bsi/shopify-liquid.md).
Schema: [Editable Surface Contract](../guides/editable-surface-contract.md)
([ADR-0058](../adr/0058-editable-surface-contract.md)).

---

## Mission

Build a **Shopify Online Store 2.0 theme** (Liquid + JSON templates + CSS/JS)
for a **beverage** shop. Replace only the **Home** with custom sections, and
leave **blog listing + article templates** ready for future Binflow blog tools.
Keep product, collection, cart, checkout, search, and customer account on the
existing theme behavior.

Binflow will later enroll this GitHub repo as a stack. You are **not**
implementing Binflow. You **must** ship an Editable Surface so future tools
(`edit_text`, `edit_text_style`, `edit_image`, blog create/delete families) can
allowlist fields without reverse-engineering the live site.

## Hard exclusions

- Do **not** build restaurant menu / PDF menu / `update_menu` surfaces.
- Do **not** invent Binflow product tools for product title, price, or
  collection title (those stay `catalog_bound`).
- Do **not** use Next.js, Hydrogen, or headless storefronts.
- Do **not** restyle the whole theme with global `h1` / `p` / `button` CSS.

## Workflow assumptions

1. Duplicate the live theme; develop on an unpublished copy.
2. Prefer Shopify CLI (`theme pull` / `theme dev`) and GitHub ↔ Shopify theme
   connection for the development theme.
3. Custom code stays isolated to Home + blog chrome/templates.

## File isolation (allowed touch set)

```text
templates/index.json
templates/article.json          # and blog listing template if separate
sections/home-*.liquid
sections/blog-*.liquid          # listing chrome, article chrome only as needed
snippets/home-*.liquid
snippets/blog-*.liquid
assets/home.* / assets/home/**
assets/blog.*                   # only if needed for blog chrome
locales/*.json                  # keys under home.* and blog.* only for new copy
binflow/surface-inventory.yaml  # REQUIRED
```

Avoid editing `product.json`, `collection.json`, `cart.json`, checkout, or
shared header/footer unless the Home absolutely needs a **conditional**
`request.page_type == 'index'` header; keep that namespaced.

## Editable Surface rules (mandatory)

Follow [editable-surface-contract.md](../guides/editable-surface-contract.md).

1. Every Binflow-intended field gets a stable **`bf_id`**
   (`home.hero.heading`, `blog.listing.intro`, …). Never rename after first ship.
2. Assign a **kind**: `copy` | `style_target` | `image` | `chrome_denied` |
   `catalog_bound`.
3. Commit **`binflow/surface-inventory.yaml`** listing every row (schema in the
   guide).
4. On rendered HTML for `copy` / `style_target` / `image` / `chrome_denied`:

```html
data-bf-id="home.hero.heading"
data-bf-kind="copy"
data-bf-section="hero"
```

5. Section schema **setting ids** for copy: `heading`, `subheading`, `body`,
   `description`, `caption`, `eyebrow`, …  
   CTAs: `button_label`, `button_url` (kind `chrome_denied`).  
   Images: `image` / `image_mobile` / `background_image` + `image_alt`.
6. Default copy strings must be **unique** enough for substring targeting.
7. Namespace CSS under `.home-*` / `.bf-surface-*` / `.custom-home`. Use CSS
   variables for type tokens. No bare element selectors from Home CSS.
8. Keep `style_target` copy in a single text node when possible.

## Home

- Drive Home from `templates/index.json` using only `home-*` section types.
- One concern per section file (`home-hero`, `home-featured-products`,
  `home-brand-story`, `home-cta`, … as the design requires).
- Featured products: show live Shopify products (`catalog_bound` for
  title/price/url). Marketing chrome around them is `copy` / `image`.
- Prefer `image_picker` settings over hardcoded CDN URLs.

## Blog

- Use native Shopify **Articles / Blog**.
- Theme owns listing + article **templates/sections**.
- Article `title`, `content`, `excerpt`, featured image =
  `catalog_bound` → `publication_target: shopify_admin_articles` in inventory.
- Listing intro, empty state, related-posts heading = `copy` / `image` under
  `blog.*` with GitHub theme as publication target.
- Mark clear DOM regions for title, featured image, and body so a future
  verify step can assert publish success.

## Source of truth

For allowlisted Git-backed fields, **GitHub is the Binflow source of truth**.
Theme Editor may sync settings; do not rely on Editor-only edits as the
long-term content API for fields listed in the inventory. Document that in the
PR.

## Capability families to anticipate (do not implement)

| Family | What to leave ready |
|--------|---------------------|
| `edit_text` | Unique `copy` fields + markers + inventory |
| `edit_text_style` | `style_target` nodes, single text nodes |
| `edit_image` | Named image slots + alts; no logo/nav as `image` kind |
| Blog create/delete | Article/blog templates + `catalog_bound` article rows |
| Menu | **Out of scope — do not build** |

## PR deliverables checklist

- [ ] Only allowed paths changed (Home + blog chrome/templates + inventory)
- [ ] `binflow/surface-inventory.yaml` complete and valid per guide schema
- [ ] Every editable node has `data-bf-id` / `data-bf-kind` / `data-bf-section`
- [ ] CTA/nav/footer fields marked `chrome_denied` (not `copy`)
- [ ] Product/article native fields marked `catalog_bound`
- [ ] CSS namespaced; no global element rules from custom Home CSS
- [ ] Unique default sample strings for copy rows
- [ ] No menu / PDF menu surfaces
- [ ] Short PR note: inventory `bf_id` table summary + Theme Editor vs Git warning

## Out of scope for this agent

- Binflow enrollment, GitHub App, Telegram tools, Shopify Admin API ports
- Publishing the theme to production without human QA
- Rewriting checkout or customer accounts
