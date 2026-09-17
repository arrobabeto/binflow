# ADR-0058: Editable Surface Contract (site-first)

- Status: Accepted
- Date: 2026-09-03
- Supersedes: None
- Superseded by: None

## Context

Binflow capabilities such as `edit_text`, `edit_text_style`, `edit_image`, and
blog create/delete discover allowlisted fields after a site already exists
(Orbitype section field names, path globs, ad hoc denylists). That reverse
order forced fragile heuristics (for example denying page `hero` image slots by
name) and made each new stack re-learn the same content shapes.

New client sites—especially greenfield themes such as a Shopify Liquid
storefront—can declare editable fields **before** the first capability ships.
A shared, profile-agnostic vocabulary lets agents build sites that future stack
tools can allowlist without scraping markup for intent.

Related binding decisions that remain unchanged: ADR-0005 (capabilities and
manifests), ADR-0020 (code-owned catalog and bindings), ADR-0042 (tool
isolation). Stack-specific path builders and publication ports stay owned by
each profile.

## Decision

1. **Editable Surface Contract.** Canonical guide
   [`docs/guides/editable-surface-contract.md`](../guides/editable-surface-contract.md)
   defines Editable Surface, Surface Inventory, `bf_id`, field kinds
   (`copy`, `style_target`, `image`, `chrome_denied`, `catalog_bound`), markup
   markers, naming rules, and the inventory artifact schema.

2. **Site-first for new Binflow-intended sites.** Before the first content
   capability on a new project/repo intended for Binflow, the site must ship:
   - a committed Surface Inventory (`binflow/surface-inventory.yaml` or
     equivalent documented path), and
   - storefront markup markers (`data-bf-id`, `data-bf-kind`, `data-bf-section`)
     on declared surfaces where HTML is rendered.

3. **Grandfather existing pilots.** Webbin (`astro_repo`) and Bistro
   (`astro_orbitype`) remain valid without an inventory. Executors may keep
   heuristic discovery. When an inventory is present, tools **should prefer**
   inventory + markers over name scraping; migrating pilots is optional and
   out of scope of this ADR. Platform naming and per-stack implementer briefs
   are clarified in [ADR-0064](0064-optional-bsi-astro.md) (**Binflow Surface
   Inventory / BSI**); Astro enrollment does not require BSI.

4. **Layering.** The contract sits **above** stack-specific
   `editablePaths` / CMS schemas. It does not replace manifests, publication
   targets, or approval policy. A future Shopify (or other) profile maps
   inventory rows into that stack’s manifest and ports.

5. **Capability families, not binary reuse.** Anticipating “existing tools”
   means designing surfaces for the same **families** (literal copy replace,
   style wrap, image slot replace, blog create/delete). Capabilities remain
   stack-bound; `astro_orbitype` executors are not run against Liquid.

6. **Exclusions stay explicit per project.** Restaurant menu surfaces
   (`update_menu`) and catalog product/collection mutation are not required by
   the contract; individual briefs may exclude them (for example beverage
   Shopify storefront + blog only).

7. **Inventory freshness (amended by ADR-0061).** The inventory YAML must stay
   aligned with markers after theme pushes. Client agents own the push gate;
   Binflow may remap and publish inventory-only PRs (deep search / future
   webhook). Tools still **read** inventory; they do not scrape markers as the
   primary allowlist at search time.

## Consequences

- Positive: greenfield sites produce stable `bf_id`s and inventories that
  enrollment/tools can seed instead of reverse-engineering.
- Positive: one glossary shared by Astro, Shopify Liquid, and future profiles.
- Cost: site-build PRs gain an inventory checklist; agents must follow the
  guide/brief.
- Risk: dual editing (Theme Editor vs GitHub) remains an operational concern;
  the contract states GitHub (or the stack’s declared source of truth) owns
  allowlisted fields for Binflow.
- No product code, migrations, or executor changes in this decision.

## Alternatives considered

- Keep only stack-specific discovery forever: rejected; repeats Orbitype
  friction on every new profile.
- Require inventory on existing pilots immediately: rejected; unnecessary
  churn for Webbin/Bistro.
- Encode the contract only inside a Shopify brief: rejected; vocabulary must
  be canonical for all future stacks.

## Verification

- Guide and glossary terms published and linked from `docs/README.md`.
- Shopify beverage agent brief references the guide and requires inventory +
  markers in its PR checklist.
- No capability registry or workflow behavior changes required for acceptance
  of this ADR.
