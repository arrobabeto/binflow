# BSI implementer brief — `astro-repo`

Paste this brief when building or retrofitting an **Astro content-collections**
site (no Orbitype) for Binflow — e.g. Webbin-class portfolios/blogs.

Platform rules:
[Binflow Surface Inventory](../../guides/binflow-surface-inventory.md) and
[Editable Surface Contract](../../guides/editable-surface-contract.md)
(ADR-0058 / ADR-0064).

| | |
|--|--|
| Catalog stack | `astro-repo` |
| Profile | `astro_repo` |
| Stack tool contract | `.cursor/skills/create-tool/references/stacks/astro-repo.md` |
| Pilot reference | Webbin (grandfathered without BSI) |

**Opt-in:** without BSI, tools keep path/frontmatter/catalog discovery. With
valid BSI, inventory-aware capabilities prefer it when implemented.

## Source of truth

- **Git** is SoT for marketing pages and collections (markdown + Astro
  components). Typical paths (pilot-shaped; freeze from project manifest):
  - Blog: `src/content/articulos/*.md`, `articulos-es`, images under
    `public/images/articles/`
  - Portfolio: `proyectos` / `proyectos-es`
- Blog/portfolio **entries** are usually `catalog_bound` (title, body, cover).
- Listing chrome and static page sections are `copy` / `image` / `container`.

## Must

1. Commit `binflow/surface-inventory.yaml` with stable `bf_id`s.
2. Markers on `.astro` roots: `data-bf-id`, `data-bf-kind`, `data-bf-section`;
   backgrounds use `data-bf-presentation="background"`.
3. Mark section shells with `kind: container` when the block is a meaningful
   surface (hero, listing header, project card chrome).
4. Frontmatter / prop naming aligned with contract:
   - Copy: `heading`, `title`, `body`, `description`, `intro`, …
   - Images: `image` / `backgroundImage` + `imageAlt` (or pilot `img` mapped in
     locator notes)
   - Chrome: `ctaLabel`, `ctaHref`, … never as `copy`
5. Locators (examples — adapt to enrolled `editablePaths`):

```text
github:src/content/articulos/{slug}.md#frontmatter.title
github:src/content/articulos/{slug}.md#frontmatter.img
github:src/pages/index.astro#hero.heading
github:src/components/home/Hero.astro#backgroundImage
```

6. `publication_target`: prefer `github_content` for md/frontmatter;
   document page-component paths clearly in `path`.
7. Unique `sample` strings for copy rows that tools may substring-match.

## Must not

1. No Orbitype locators on this stack.
2. No client inventory fetch.
3. Do not mark every layout `div`.
4. Do not treat Webbin-only path constants as required for every
   `astro_repo` client — follow the **enrolled** manifest paths.
5. Do not invent a second marker vocabulary.

## Declare-only

- `video`, `overlay`, `container`
- `image` + `presentation: background`

## Markers (examples)

```astro
<section
  data-bf-id="home.hero.shell"
  data-bf-kind="container"
  data-bf-section="hero"
  class="home-hero"
>
  <h1
    data-bf-id="home.hero.heading"
    data-bf-kind="style_target"
    data-bf-section="hero"
  >{heading}</h1>

  <div
    data-bf-id="home.hero.background"
    data-bf-kind="image"
    data-bf-section="hero"
    data-bf-presentation="background"
    style={`background-image: url(${backgroundImage})`}
  />
</section>
```

## Example inventory rows

```yaml
version: 1
project_key: example-astro-repo
surfaces:
  - bf_id: home.hero.shell
    kind: container
    area: home
    section: hero
    path: src/components/home/Hero.astro
    locator: github:src/components/home/Hero.astro#shell
    locales: [es, en]
    publication_target: github_content
    sample: ""

  - bf_id: home.hero.heading
    kind: style_target
    area: home
    section: hero
    path: src/components/home/Hero.astro
    locator: github:src/components/home/Hero.astro#heading
    locales: [es]
    publication_target: github_content
    sample: "Proyectos seleccionados"

  - bf_id: catalog.article.cover
    kind: catalog_bound
    area: blog
    section: article
    path: src/content/articulos
    locator: github:src/content/articulos/{slug}.md#frontmatter.img
    locales: [es]
    publication_target: github_content
    sample: ""
    deny_reason: "Blog cover — create/delete blog family, not storefront edit_text"
```

## Greenfield checklist

- [ ] BSI YAML + markers for Home / listing chrome
- [ ] Containers + background presentations where used
- [ ] Collection paths match intended enrollment `editablePaths`
- [ ] Catalog rows for blog/portfolio entry fields marked `catalog_bound`
- [ ] README links this brief + BSI general guide

## Retrofit checklist (existing site)

- [ ] Map current Telegram-editable surfaces into inventory without renaming
      live copy
- [ ] Add markers in components that already render those values
- [ ] Keep grandfathered heuristic behavior working if inventory incomplete
- [ ] Confirm `productionOrigin` / routes stay enrollment-owned (ADR-0048)

## Minimal Home / listing set

- `home.hero.shell`, heading/body, image or background
- `blog.listing.intro` (or locale equivalent) as `copy` if listing chrome exists
- Portfolio listing chrome under `portfolio.*` when the site has projects
