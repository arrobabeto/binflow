# Glossary

| Term             | Meaning                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Approval         | Permission from an authorized user bound to one exact request version and preview artifact.                  |
| Artifact         | Versioned output such as Markdown, image, diff, screenshot or CMS draft.                                     |
| Capability       | User-visible, typed operation that a project explicitly enables.                                             |
| Checkpoint       | Durable LangGraph state from which a request can resume.                                                     |
| Client           | A tenant's authorized website owner/editor using the client Telegram bot.                                    |
| Content catalog  | Searchable synchronized index of source-of-truth content and active Binflow drafts.                          |
| Executor         | Deterministic implementation of a capability for a supported profile/manifest.                               |
| Global manifest  | Code-owned maximum contract for a technical profile.                                                         |
| Graph            | Versioned LangGraph workflow or capability subgraph.                                                         |
| Grant            | Explicit authorization for a tenant to use a platform credential; outside the first MVP.                     |
| Manifest         | Versioned configuration binding a project to allowed fields, paths, locales, checks and executors.           |
| Node             | One versioned workflow step with defined input, output, timeout, retry and budget behavior.                  |
| Policy engine    | Deterministic service that calculates permission, effective risk and required approvals.                     |
| Preview artifact | Exact reviewable deployment or CMS version associated with a request version.                                |
| Project          | One managed website and its integrations, manifest and policies.                                             |
| Request          | A user's desired operation; it may contain multiple immutable request versions.                              |
| Request version  | One frozen plan and artifact set; revisions create a new version and invalidate approvals.                   |
| Tenant           | Security and data-isolation boundary for one client organization.                                            |
| Tool             | In LLM context, a bounded read or capability proposal schema. Internal publication operations are not tools. |
| Webbin           | Read-only reference and first `astro_repo` pilot; it remains a separate repository.                          |
