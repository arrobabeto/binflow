# Glossary

| Term             | Meaning                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Approval         | Permission from an authorized user bound to one exact request version and preview artifact.                  |
| Artifact         | Versioned output such as Markdown, image, diff, screenshot or CMS draft.                                     |
| Capability       | User-visible, typed operation that a project explicitly enables; synonym for dashboard **Tool** when listing enabled operations. |
| Checkpoint       | Append-only workflow stage record for a graph run; used for progress and audit, not mid-stage resume.        |
| Client           | A tenant's authorized website owner/editor using the client Telegram bot.                                    |
| Content catalog  | Searchable synchronized index of source-of-truth content and active Binflow drafts.                          |
| Customization    | Versioned client markdown that supplies style and structure guidance for one assigned capability.            |
| Executor         | Deterministic implementation of a capability for a supported profile/manifest.                               |
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
| Stack            | Catalog directory such as `astro-repo`; each tool binds to one stack. Project **profile** uses underscores (`astro_repo`, `astro_orbitype`). |
| Tenant           | Security and data-isolation boundary for one client organization.                                            |
| Tool (dashboard) | Synonym for a versioned capability shown in the Tools catalog, grouped by stack.                             |
| Tool (LLM)       | Bounded read or capability-proposal schema visible to a model. Internal publication operations are not LLM tools. |
| Orbitype         | Third-party CMS accessed via API key for `astro_orbitype` enrollments (ADR-0045). Content tools are later. |
| Webbin           | Read-only reference and first `astro_repo` pilot; it remains a separate repository.                          |
