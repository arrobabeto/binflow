# BSI implementer brief — `wordpress-rest`

Paste this brief when building or retrofitting a **classic self-hosted
WordPress** site (theme + REST API) intended for Binflow.

Platform rules:
[Binflow Surface Inventory](../binflow-surface-inventory.md) and
[Editable Surface Contract](../editable-surface-contract.md)
(ADR-0058 / ADR-0064). Enrollment: [ADR-0066](../../../adr/0066-wordpress-rest-enrollment.md).

| | |
|--|--|
| Catalog stack | `wordpress-rest` |
| Profile | `wordpress_rest` |
| Stack tool contract | `.cursor/skills/create-tool/references/stacks/wordpress-rest.md` |

**Opt-in / no tools yet:** BSI is **not** required to enroll and no WordPress
tool reads it today. There is no Git repository on this stack, so the
platform rule “inventory lives in Git” cannot apply yet; where a WordPress
inventory lives (Binflow-stored vs site-hosted) is decided by the first tool
that needs one. Until then, markers are **declare-only** and cost nothing.

## Source of truth

- Content lives in the WordPress database, reached only through the REST API
  (`wp/v2`). Binflow never edits theme or plugin files on this stack.
- Posts, pages, categories and media are addressed by REST object ids/slugs,
  not file paths.
- Future `publication_target` value: `wordpress` (REST). Not used by any tool
  yet.

## Must

1. Keep marketing surfaces that Binflow might edit inside REST-reachable
   content (post/page content, excerpts, featured images, categories), not
   hardcoded in theme PHP.
2. When the theme renders such a surface, add BSI markers on the rendered root
   node:

```php
<h1 data-bf-id="home.hero.heading" data-bf-kind="copy" data-bf-section="hero">
  <?php echo esc_html( get_the_title() ); ?>
</h1>
```

3. Background images painted on a section/div:

```php
<section
  data-bf-id="home.hero.background"
  data-bf-kind="image"
  data-bf-section="hero"
  data-bf-presentation="background"
  style="background-image:url('<?php echo esc_url( $hero_url ); ?>')">
```

4. Mark meaningful section shells as `container` (`home.hero.shell`); not every
   wrapper.
5. CTA labels/links → `chrome_denied`; native post/category objects →
   `catalog_bound` until a tool owns them.
6. Unique sample text per surface (no repeated “Leer más”).

## Must not

1. Do not invent a second tag system (no `data-wp-binflow-*`, no shortcodes
   as labels).
2. Do not expose plugin, theme, menu or settings values as editable surfaces —
   Binflow’s WordPress adapter never calls those endpoints (ADR-0066).
3. Do not rely on page-builder internal ids (Elementor, Divi, etc.) as `bf_id`.
4. Do not put editable copy only in CSS `content:`.

## Declare-only

- All kinds on this stack are declare-only until a WordPress tool ships:
  `copy`, `image`, `style_target`, `container`, `overlay`, `video`,
  `presentation: background`.

## Markers / inventory examples

Locators use REST objects instead of file paths:

```yaml
version: 1
project_key: example-wp
surfaces:
  - bf_id: home.hero.heading
    kind: copy
    area: home
    section: hero
    path: wp/v2/pages/home
    locator: title.rendered
    locales: [es]
    publication_target: wordpress
    sample: "Titular único de portada"

  - bf_id: blog.post.featured_image
    kind: image
    area: blog
    section: post
    path: wp/v2/posts/{id}
    locator: featured_media
    locales: [es]
    publication_target: wordpress
    sample: ""

  - bf_id: blog.post.category
    kind: catalog_bound
    area: blog
    section: post
    path: wp/v2/categories
    locator: categories
    locales: [es]
    publication_target: wordpress
    sample: ""
    deny_reason: "Category assignment owned by future blog tool"
```

## Greenfield checklist

- [ ] Editable copy and images come from REST-reachable content, not theme PHP
- [ ] Markers on declared surfaces; containers/backgrounds where used
- [ ] CTAs marked `chrome_denied`
- [ ] No page-builder ids used as `bf_id`

## Retrofit checklist

- [ ] Identify which surfaces are post/page content vs hardcoded theme output
- [ ] Add markers in theme templates for the surfaces worth editing later
- [ ] Note hardcoded surfaces as out of reach (theme files are not edited by
      Binflow on this stack)
