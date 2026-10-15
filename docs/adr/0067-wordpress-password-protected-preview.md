# ADR-0067: WordPress preview artifact = password-protected live post

- Status: Accepted
- Date: 2026-10-14
- Supersedes: None
- Superseded by: None
- Amends: ADR-0006 (defines the exact preview artifact for `wordpress_rest`
  capabilities), ADR-0066 decision 7 (preview decided per capability)

## Context

ADR-0006 requires every mutable request to produce an exact, version-bound
preview before production, and binds approvals to that artifact. ADR-0066
enrolled classic WordPress sites without the audited “WebOps Signed Preview”
plugin and deferred the preview artifact to the first WordPress capability.

Classic WordPress has no Binflow-controllable preview deployment: draft
previews require a logged-in session (`?preview=true` + nonce) and cannot be
shared with a Telegram client. The first WordPress tool,
`create_blog_wordpress`, needs a preview the client can open on their phone.

The product owner first proposed publishing directly and deleting the post on
rejection. That violates ADR-0006 (production before approval), so the
accepted compromise is a WordPress-native access gate on a live URL.

## Decision

1. **Preview artifact.** For `wordpress_rest` blog creation the preview is the
   real post, created through REST with `status: publish` **and** a non-empty
   WordPress post `password`. WordPress renders only the password form (and
   the title, prefixed “Protected:”) to visitors without the password; REST
   returns `content.protected: true` and an empty rendered body to
   unauthenticated callers.
2. **Exact binding.** Client and admin approvals bind to the tuple
   `(post id, modified_gmt, content hash)`, where the content hash is SHA-256
   over the title, raw content, excerpt, featured media id and category ids
   Binflow wrote. The tuple is stored as the request version's evidence
   (`repo_changes.head_sha` / `deployments.provider_id` carry the WordPress
   identifiers; there is no Git commit).
3. **Invalidation.** Before publication Binflow re-reads the post. If
   `modified_gmt` or the content hash differs from the approved tuple (for
   example an edit in wp-admin), the approval is void: Binflow creates a new
   request version with the observed state and reopens client review.
4. **Publication.** “Publish” means removing the password (and, when an admin
   approved a new category, creating it and assigning it in the same update),
   then verifying unauthenticated REST shows `content.protected: false` and the
   public `link` responds `200` on the enrolled origin.
5. **Rejection / cancel.** Cancelling the request or an admin rejection moves
   the post to the WordPress trash (`DELETE` without `force=true`). Binflow
   never permanently deletes posts. Media uploaded for the request stays in
   the media library (WordPress media has no trash by default).
6. **Preview password handling.** The password is generated per request
   (random, 12 characters), sent to the requesting client in Telegram together
   with the URL, and stored only in the request's terminal result while the
   request is open. It is not a Binflow credential and grants read access to
   one unpublished post. It is cleared from the terminal result when the
   request completes or is cancelled.
7. **Content safety.** Application Password users (Editor/Administrator) may
   hold `unfiltered_html`, so WordPress will not sanitize what Binflow writes.
   Model output is therefore restricted to schema-validated limited Markdown and
   rendered to HTML by deterministic code that escapes all markup; titles and
   excerpts are written as escaped plain text. No model-authored HTML reaches
   WordPress.
8. **Failure cleanup.** A final failure, or a run that completes after the
   request was cancelled, trashes the still-protected post. A post whose
   password was already removed is public and is never trashed automatically.

## Consequences

- Positive: the client sees the article rendered by their real theme on the
  enrolled origin; no plugin or logged-in session is required.
- Residual risk (accepted): the post title appears in archives, feeds, sitemaps
  and search with the “Protected:” prefix until approval; plugins that react
  to `publish` (newsletters, social auto-posting, IndexNow, webhooks) may fire
  at preview time. Operators must disable such automations for sites using
  this capability; ENROLLMENT and OPERATIONS document the check.
- Residual risk (accepted): anyone holding the password can read the draft
  text; it is delivered only in the client's paired Telegram chat.
- Cost: WordPress capabilities store pseudo Git evidence (`wp-post:` ids) in
  `repo_changes` / `deployments` so the shared approval path keeps working.

## Alternatives considered

- Publish without preview and delete on rejection: rejected (violates
  ADR-0006).
- Draft + logged-in preview link: rejected (clients have no wp-admin access).
- Audited Signed Preview plugin: deferred (ADR-0066 removed it as a gate).
- Private status (`status: private`): rejected (only logged-in editors can read
  it).

## Verification

- Spec [create-blog-wordpress.md](../specs/create-blog-wordpress.md).
- Unit tests: route allowlist (writes only to posts, media, categories; trash
  without `force`), protected-preview verification, approval invalidation on
  `modified_gmt` / hash drift, trash on cancel.
- Live smoke (pilot site): protected URL + password reaches the client; wp-admin
  edit reopens review; approve removes password; cancel trashes the post.

## See also

- [ADR-0006](0006-preview-and-approval.md)
- [ADR-0066](0066-wordpress-rest-enrollment.md)
