# BSI implementer brief — `astro-orbitype`

Paste this brief when building or retrofitting an **Astro + Orbitype** site for
Binflow. Platform rules:
[Binflow Surface Inventory](../../guides/binflow-surface-inventory.md) and
[Editable Surface Contract](../../guides/editable-surface-contract.md)
(ADR-0058 / ADR-0064).

| | |
|--|--|
| Catalog stack | `astro-orbitype` |
| Profile | `astro_orbitype` |
| Stack tool contract | `.cursor/skills/create-tool/references/stacks/astro-orbitype.md` |

**Opt-in:** repos without BSI keep today’s Orbitype field-name heuristics. With
valid BSI, tools that support inventory prefer it; otherwise fall back.

## Source of truth

- Page marketing copy/images/CTAs: **Orbitype** pages (`publication_target:
  orbitype_pages`), often dual-written to Git CMS mirrors.
- Blog posts: markdown under `src/content/blog-{locale}/*.md` + Orbitype posts
  where dual-write applies (`catalog_bound` / `github_content`).
- Do **not** treat `sections[]` array index as identity.

## Must

1. Commit `binflow/surface-inventory.yaml` (version 1) with stable `bf_id`s:
   `{area}.{section}.{field}`.
2. On each editable **root** in `.astro`:
   - `data-bf-id`, `data-bf-kind`, `data-bf-section`
   - CSS background images: also `data-bf-presentation="background"` and
     inventory `presentation: background` on the painted `div`/`section`
3. Mark important shells with `kind: container` (e.g. `home.hero.shell`).
4. Orbitype / prop names (camelCase):
   - Copy/style: `heading`, `subheading`, `title`, `body`, `description`,
     `text`, `intro`, `lead`, `paragraph`, `caption`, `eyebrow`
   - Images: `image` / `imageMobile` / `backgroundImage` + `imageAlt`
   - Chrome: `ctaLabel`, `ctaHref`, `ctaSecondaryLabel`, `ctaSecondaryHref`
   - Style sibling: `{field}Style` (e.g. `headingStyle`) for `edit_text_style`
5. Locators use stable **componentId** (`_orbi.component` and/or explicit `id`):

```text
orbitype:pages/{pageSlug}/sections/{componentId}/{field}@{locale}
github:cms/collections/{slug}.json#/sections/{componentId}/{field}
github:src/content/blog-{locale}/{file}.md#frontmatter.img
```

6. Unique `sample` strings per copy row.
7. Optional `bf()` helper only builds attrs — no runtime discovery.

## Must not

1. No client inventory loader / discovery scripts.
2. Do not mark every nested span or anonymous layout `div`.
3. Do not require BSI for the site to function.
4. Do not mix CTA fields into `copy` kinds.
5. Do not invent parallel attributes beyond `data-bf-*` (and Binflow-applied
   `data-binflow-style` from tools).
6. Do not expand Astro tool scope in a labeling-only change.

## Declare-only (ship now; tools may ignore)

- `video` (`videoUrl`, `videoPoster`)
- `overlay` (popup / banner / modal)
- `container` (section shell)
- `image` + `presentation: background`

## Markers (examples)

```astro
<section
  data-bf-id="home.hero.shell"
  data-bf-kind="container"
  data-bf-section="hero"
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
    role="img"
    aria-label={imageAlt}
  />

  <a
    data-bf-id="home.hero.cta"
    data-bf-kind="chrome_denied"
    data-bf-section="hero"
    href={ctaHref}
  >{ctaLabel}</a>
</section>
```

## Example inventory rows

```yaml
version: 1
project_key: example-astro-orbitype
surfaces:
  - bf_id: home.hero.shell
    kind: container
    area: home
    section: hero
    path: src/components/home/Hero.astro
    locator: orbitype:pages/home/sections/Hero@de
    locales: [de]
    publication_target: orbitype_pages
    sample: ""
    notes: "Section shell — declare-only"

  - bf_id: home.hero.heading
    kind: style_target
    area: home
    section: hero
    path: src/components/home/Hero.astro
    locator: orbitype:pages/home/sections/Hero/heading@de
    locales: [de]
    publication_target: orbitype_pages
    sample: "Willkommen im Beispielbistro"

  - bf_id: home.hero.background
    kind: image
    area: home
    section: hero
    path: src/components/home/Hero.astro
    locator: orbitype:pages/home/sections/Hero/backgroundImage@de
    locales: [de]
    publication_target: orbitype_pages
    presentation: background
    sample: /images/home/hero-bg.jpg
    alt_locator: orbitype:pages/home/sections/Hero/imageAlt@de
```

## Greenfield checklist

- [ ] `binflow/surface-inventory.yaml` for Home + shared chrome (+ overlays)
- [ ] Markers match inventory; containers + backgrounds declared
- [ ] Locators use componentId, not section index
- [ ] No client-side inventory code
- [ ] Template README links this brief + BSI general guide

## Retrofit checklist (existing site)

- [ ] Inventory covers surfaces clients already edit via Telegram tools
- [ ] Markers added without changing visual design
- [ ] Heuristic field names preserved where tools still scrape
- [ ] Dual-write Git mirrors noted in `notes` when both apply
- [ ] Verify production HTML contains `data-bf-*` on declared roots

## Minimal Home set

- `home.hero.shell` (`container`) when hero is a block
- `home.hero.heading`, `home.hero.body`
- `home.hero.image` **or** `home.hero.background` (`presentation: background`)
- `home.hero.cta` if primary CTA exists
- Shared nav/footer chrome or newsletter `overlay` if present
