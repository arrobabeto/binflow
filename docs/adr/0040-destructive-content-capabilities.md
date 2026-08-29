# ADR-0040: Destructive content capabilities (delete project)

- Status: Accepted
- Date: 2026-08-28
- Supersedes: None
- Superseded by: None

## Context

The tool authoring pipeline for destructive capabilities (`delete_project_astro`,
`delete_blog_draft`) exposed that Binflow's publication stack was optimized for
create/update preview flows. Removing content requires file deletion, catalog
tombstoning, and production absence verification.

## Decision

1. **Destructive capabilities require a Proposed ADR** listing platform gaps before
   catalog registration or migration insert.
2. **Deletion model:** deletion PR that removes manifest-known paths; merge after
   admin approval; verify production routes return **404** (absence) for deleted
   content. Post-deletion HTTP redirects are deferred per
   [ADR-0041](0041-defer-delete-blog-redirects.md) until the client repo supports
   a stack-native redirect mechanism. No Vercel preview deploy for delete.
3. **Approval policy:** admin-only for destructive tools (`webbin-project-deletion@1`,
   `webbin-blog-deletion@1`); clients may request deletion but cannot approve publication.
4. **Platform work (implemented for destructive tools):**
   - GitHub adapter: `DELETE /repos/{owner}/{repo}/contents/{path}` with commit message
   - `RepositoryPublicationPort` deletion drafts (`deletions` + empty `files`)
   - `DeploymentPort.verifyAbsence` for production verification;
     `verifyDeletionRedirects` reserved for future stack-native redirect support
     (ADR-0041)
   - Runtime path setting `content_catalog_items.status = 'deleted'`
   - `workflow.delete_blog@1` and `workflow.delete_project@1` executors + worker registry
   - Telegram `/delete_blog` and `/delete_project` ingress with title/URL collection
   - Fix `reviseRequest` to parse capability-specific input (today hardcodes blog schema)

## Consequences

- `delete_blog_draft@2` is registered with manifest-driven blog deletion scope.
- `delete_project_astro@2` is registered with manifest-driven portfolio deletion scope.
- Future destructive tools (unpublish blog, archive) reuse the same gap checklist.

## Alternatives considered

- **Soft-delete frontmatter only** — rejected; leaves live routes and catalog embeddings.
- **Direct production delete without preview** — rejected; violates ADR-0006 exact preview.

## Verification

- ADR-0040 checklist complete before promoting spec status to Accepted
- Conformance test includes delete tool once registered
- Scenario matrix in `docs/TESTING.md` for destructive flows
