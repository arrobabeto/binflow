# Create blog (WordPress REST) — capability specification

Capability id: `create_blog_wordpress@1`  
Stack: `wordpress-rest` · Profile: `wordpress_rest`  
Executor: `workflow.create_blog_wordpress@1`  
Command: `/create_blog` (same command as other stacks; routed by the enabled
capability)  
Graph: `stacks/wordpress-rest/create-blog@1`  
Mutation class: `create` · Risk: medium · `requiresPreview: true`
(password-protected live post, [ADR-0067](../adr/0067-wordpress-password-protected-preview.md))

---

## 1. Three layers

- **code** — Collection interview, gap detection, WordPress REST write port
  (posts, media, categories only), idempotent lookups, protected-preview
  evidence, approval invalidation, trash on cancel, timeout notices.
- **manifest** — `wordpress.siteOrigin`, `wordpress.restBase`,
  `wordpress.productionOrigin`, `wordpress.userId`, `contentLocales`
  (monolingual only in v1).
- **customization** — Untrusted markdown for the `generate`, `apply_revision`
  and `prepare_image` nodes (voice, audience, structure, cover mood). It cannot
  change models, routes, permissions, approvals or the “as-is” behaviour. The
  project's own style rules live in a separate customization document (see
  `docs/customizations/example-create-blog-wordpress.md`).

## 2. Modes (chosen with two buttons at the start of every request)

| Mode | Token | Behaviour |
|------|-------|-----------|
| As-is (“Tal cual”) | `pick_wp_blog_mode:as_is` | The client's text is published verbatim (formatted to HTML paragraphs/headings/lists only). Binflow never rewrites, summarizes or translates it. The interview only fills gaps: title, excerpt (optional), category, image. |
| Generate (“Generar con estilo”) | `pick_wp_blog_mode:generate` | The client sends base information; the `generate` agent writes title, excerpt and body using the contract rules plus the project customization. |

Model output (generate and revisions) is **limited Markdown only**
(paragraphs, `##`/`###`, `-`/`1.` lists, `**bold**`), validated by a schema
and rendered by the same code path as as-is text (`composeAsIsHtml`), which
escapes all HTML. The model can therefore never inject scripts, links, embeds
or arbitrary markup, even when the Application Password user has
`unfiltered_html`. Titles and excerpts are written as escaped plain text.

## 3. Collection (`NEEDS_INPUT`)

`createBlogWordpressInputSchema` `mode: 'collect'` steps:

| Step | Prompt | Advances on |
|------|--------|-------------|
| `choose_mode` | Two mode buttons + Cancel | mode button |
| `await_content` | As-is: “send the full article (several messages allowed) then tap **Listo**”. Generate: “send the base information … then **Listo**”. | text messages (appended), `wp_blog_content_done` |
| `await_title` | As-is only, when no title was detected (`# Title` first line or `Título: …`) | text |
| `await_excerpt` | As-is only: optional excerpt with **Omitir** | text or `wp_blog_skip_excerpt` |
| `choose_category` | Up to 6 suggested existing categories (token overlap with title/content, then post count) + **Nueva categoría** | `pick_wp_blog_category:<id>` / `wp_blog_new_category` |
| `await_new_category` | Name for the new category (admin approval required) | text (2–60 chars) |
| `choose_image` | “Send a photo, paste an image URL from your site, or tap **Generar con IA**” | Telegram photo, same-origin URL, `pick_wp_blog_image:ai` |
| `ready` | Plan summary + **Crear borrador protegido** / Cancel | `confirm_plan` |

Gap rules (as-is): body must be ≥ 200 characters; title 3–200 characters;
excerpt ≤ 300 characters. Image URLs must be HTTPS (or the enrolled origin
scheme) on the enrolled site host; other hosts are refused. Category
suggestions come from an injected `WordpressBlogCatalogLoader` (worker reads
`wp/v2/categories` with the project credential).

## 4. Execute input

`mode: 'execute'`: `blogMode`, `projectId`, `content` (client text or base
info), `title?`, `excerpt?`, `category` (`{kind:'existing', id, name}` or
`{kind:'new', name}`), `image` (`{source:'telegram', artifactKey}` |
`{source:'site_url', url}` | `{source:'ai'}`), `revisionNotes[]`.

## 5. Graph pipeline

| node.id | nodeKind | kind | Notes |
|---------|----------|------|-------|
| `catalog_sync` | `wordpress.catalog_sync@1` | effect | Re-reads categories; existing pick must still exist |
| `compose_article` | `wordpress.compose_as_is@1` | compute | As-is → HTML, no rewriting |
| `generate` | `content.generate_blog@1` | agent | `gpt-5.6-terra` / medium, customizable |
| `prepare_image` | `content.prepare_image@1` | agent | `gpt-image-2`, AI image only, customizable |
| `upload_media` | `wordpress.upload_media@1` | effect | Lookup by slug before upload |
| `upsert_protected_post` | `wordpress.upsert_protected_post@1` | effect | `status: publish` + password; lookup before create |
| `verify_protected_preview` | `wordpress.verify_protected_preview@1` | effect | Unauthenticated REST shows `content.protected: true` |
| `awaiting_client_approval` | `await.client_approval@1` | interrupt | Approve / Request changes / Cancel |
| `apply_revision` | `content.apply_revision@1` | agent | Same post updated; new version binding |
| `awaiting_admin_approval` | `await.admin_approval@1` | interrupt | Only for a new category |
| `create_category` | `wordpress.create_category@1` | effect | Lookup by slug before create |
| `unlock_post` | `wordpress.unlock_post@1` | effect | Re-check binding, remove password |
| `verify_production` | `wordpress.verify_production@1` | effect | Unauthenticated REST + public link 200 |
| `trash_post` | `wordpress.trash_post@1` | effect | On cancel / admin reject |
| `completed` | `workflow.completed@1` | compute | |

## 6. WordPress REST allowlist (code-enforced)

| Method | Route |
|--------|-------|
| GET | `wp/v2/categories`, `wp/v2/posts`, `wp/v2/posts/{id}`, `wp/v2/media`, `wp/v2/users/me` |
| POST | `wp/v2/posts`, `wp/v2/posts/{id}`, `wp/v2/media`, `wp/v2/media/{id}`, `wp/v2/categories` |
| DELETE | `wp/v2/posts/{id}` without `force` (trash) |

Plugins, themes, users (other than `me`), settings and menus stay forbidden
(ADR-0066). Public page reads for verification use the same origin without the
Authorization header. Cross-host redirects are refused for every call.

## 7. Approval binding and states

- Execute ends in `AWAITING_CLIENT_APPROVAL` with evidence rows: artifact
  `wordpress_post_snapshot` (password omitted), `repo_changes.head_sha =
  wp:<id>:<modified_gmt>:<hash16>`, preview `deployments.provider_id =
  wp-post:<id>:<request version id>` and `urls.post = <link>`.
- `terminalResult.wordpress` is the durable checkpoint: post id, link,
  password (while open), `modified_gmt`, content hash, `unlocked`, `trashed`.
  A retry adopts the checkpointed post (or, after a crash between POST and the
  checkpoint, a same-author protected post with the exact title) instead of
  creating a duplicate. Stale-execution recovery preserves this checkpoint, and
  an `execute` resume on a revision version runs the revision path.
- `approve_preview`: existing category → `APPROVED_FOR_PUBLISH` → publish
  resume; new category → `AWAITING_ADMIN_APPROVAL`.
- Publish re-reads the post; drift in `modified_gmt` or content hash → new
  request version, `AWAITING_CLIENT_APPROVAL`, client notified with fresh
  buttons (`wordpress_post_changed`).
- `request_revision` → `REVISION_REQUESTED`; the next client text creates a new
  version and queues `apply_revision` directly (no revision-plan step).
- Cancel (any open state after plan confirmation) and admin reject queue the
  `discard_wordpress_post` resume, which trashes the post if one exists. A run
  that finishes after a cancel refuses to persist the preview and trashes its
  post. A final (non-retryable) failure also trashes a still-protected post;
  once unlocked a post is public and is never trashed automatically.
- Revision versions recompute `categoryKind` conservatively: a new category
  still requires admin approval even if earlier evidence was lost.

## 8. Client-facing messages

- Preview (`renderWordpressPreviewNotice`): title, “live but
  password-protected”, the password, an **Open post** link button and
  Approve / Request changes / Cancel. After a wp-admin edit the same notice is
  prefixed with “The post was edited in WordPress…”.
- Published (`renderWordpressPublishedNotice`): “The post is now public.” +
  **View post** button.
- Cancel / admin reject: the standard cancellation reply; trashing happens in
  the background.
- Timeout: when the WordPress host times out or is unavailable
  (`wordpress_timeout` / `wordpress_unavailable`), the client gets “Your
  WordPress site did not respond in time…”: during collection as the reply,
  during execute/revision/publish from the worker on each retryable attempt
  (at most the policy's 3 attempts) before the queue retries. Discard runs stay
  silent. A final failure uses the standard failure notice.

## 9. Typed errors

| Code | When |
|------|------|
| `wordpress_route_denied` | Any call outside the allowlist |
| `wordpress_timeout` / `wordpress_unavailable` | Retryable host failures (client notified) |
| `wordpress_category_missing` | Picked category no longer exists |
| `wordpress_image_origin_denied` | Image URL is not on the enrolled host |
| `wordpress_image_invalid` | Image is not JPEG/PNG/WebP or exceeds 10 MB |
| `wordpress_preview_not_protected` | Unauthenticated REST does not report `protected: true` |
| `wordpress_post_changed` | Approved binding drifted before publication |
| `wordpress_publish_unverified` | Public verification failed after unlock |
| `wordpress_request_cancelled` | Run finished after the request was cancelled |
| `wordpress_credential_missing` | No active project `wordpress-api` credential |

## 10. Runtime wiring

- `@binflow/workflows`: `wordpress-blog-collection.ts` (interview),
  `wordpress-blog-content.ts` (gap rules, as-is renderer, copy),
  `wordpress-blog-runtime.ts` (`WordpressBlogWorkflowRuntime`: execute,
  applyRevision, publish, discard).
- `@binflow/wordpress`: `createWordpressBlogPublicationPort` with
  `WORDPRESS_BLOG_ROUTE_RULES`.
- `@binflow/ai`: `createOpenAIWordpressBlogGenerationPort` (structured
  outputs, `gpt-image-2` cover, model-call accounting).
- Worker: `apps/worker/src/wordpress-blog-job.ts` handles every resume for
  this capability before the GitHub-backed execution context is loaded
  (no GitHub/Vercel credentials are required). Same daily and per-request
  budget gates as other runtimes.

## 11. Verification

- Unit (`packages/wordpress/test/wordpress-blog-publication.test.ts`): route
  allowlist and trash-without-force; protected create/update refusal without a
  password; post adoption rules; media/category reuse by slug; anonymous
  protected check before/after unlock; escaping and content hash.
- Unit (`packages/workflows/test/wordpress-blog-content.test.ts`): title split,
  as-is composition keeps every word and escapes HTML, gap steps for both modes,
  category ranking/matching, same-origin image URLs, ingress/runtime wiring and
  action recognition.
- Conformance: tool/registry/contract/migration/catalog-copy alignment.
- Not yet covered by automated tests: DB-backed end-to-end of the runtime
  (drift reopen, cancel race, publish) — covered by the live smoke on a pilot
  site (ADR-0067 verification list).
