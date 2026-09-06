# Glossary

| Term             | Meaning                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Approval         | Permission from an authorized user bound to one exact request version and preview artifact.                  |
| Artifact         | Versioned output such as Markdown, image, diff, screenshot or CMS draft.                                     |
| bf_id            | Stable dotted Editable Surface id (e.g. `home.hero.heading`); never rename after ship (ADR-0058).            |
| Capability       | User-visible, typed operation that a project explicitly enables; synonym for dashboard **Tool** when listing enabled operations. |
| catalog_bound    | Field kind for native catalog/CMS objects (product, collection, article body); not storefront `edit_text`.   |
| chrome_denied    | Field kind for UI chrome (CTA, nav, footer, aria) visible on site but denied to body-copy tools.             |
| Checkpoint       | Append-only workflow stage record for a graph run; used for progress and audit, not mid-stage resume.        |
| Client           | A tenant's authorized website owner/editor using the client Telegram bot (primary **owner** identity). |
| Piloter          | Optional second paired Telegram identity on the same dedicated client bot, limited to a platform-owner-assigned subset of project-enabled tools (ADR-0057). |
| Content catalog  | Searchable synchronized index of source-of-truth content and active Binflow drafts.                          |
| Customization    | Versioned client markdown that supplies style and structure guidance for one assigned capability.            |
| Editable Surface | Versioned set of allowlisted fields Binflow may mutate for one project (ADR-0058).                           |
| Executor         | Deterministic implementation of a capability for a supported profile/manifest.                               |
| field kind       | Surface Inventory classification: `copy`, `style_target`, `image`, `chrome_denied`, or `catalog_bound`.      |
| Global manifest  | Code-owned maximum contract for a technical profile.                                                         |
| Graph            | Declared capability topology (`graph.yaml`) executed by the TypeScript workflow runtime.                    |
| Grant            | Explicit authorization for a tenant to use a platform credential; outside the first MVP.                     |
| Manifest         | Versioned configuration binding a project to allowed fields, paths, locales, checks and executors.           |
| Node             | One versioned workflow step with defined input, output, timeout, retry and budget behavior.                  |
| Node kind        | Code-owned node type (`compute`, `agent`, `effect`, or `interrupt`) with fixed authorization semantics.      |
| Policy engine    | Deterministic service that calculates permission, effective risk and required approvals.                     |
| Preview artifact | Exact reviewable deployment or CMS version associated with a request version.                                |
| Project          | One managed website and its integrations, manifest and policies.                                             |
| Request          | A user's desired operation; it may contain multiple immutable request versions.                              |
| Request version  | One frozen plan and artifact set; revisions create a new version and invalidate approvals.                   |
| Stack            | Catalog directory such as `astro-repo` or `shopify-liquid`; each tool binds to one stack. Project **profile** uses underscores (`astro_repo`, `astro_orbitype`, `shopify_liquid`). |
| Surface Inventory| Machine-readable map `bf_id → kind → path/locator → locales → publication_target` shipped with the site repo. |
| Tenant           | Security and data-isolation boundary for one client organization.                                            |
| Tool (dashboard) | Synonym for a versioned capability shown in the Tools catalog, grouped by stack.                             |
| Tool (LLM)       | Bounded read or capability-proposal schema visible to a model. Internal publication operations are not LLM tools. |
| Orbitype         | Third-party CMS accessed via API key for `astro_orbitype` enrollments (ADR-0045). Content tools are later. |
| Shopify Liquid   | Online Store 2.0 theme (Liquid + JSON) enrolled as `shopify_liquid` (ADR-0059); theme GitHub is SoT for allowlisted surfaces in v1. |
| Webbin           | Read-only reference and first `astro_repo` pilot; it remains a separate repository.                          |
