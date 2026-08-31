# External integrations

## Adapter rules

- Domain code depends on typed ports, not provider SDK types.
- Connections are tenant/project scoped and health-tested during onboarding.
- Secrets are resolved immediately before use and never stored in queued payloads.
- Every mutation records provider request/delivery identifiers and idempotency metadata.
- Provider errors map to stable domain error classes.

Phase 0 credentials are created, verified, listed and revoked through the interactive CLI contract in [Public contracts](CONTRACTS.md#phase-0-credential-cli). The later dashboard uses the same application services and SecretsProvider.

Verification is externally read-only. Candidate activation and replacement follow [ADR-0014](adr/0014-integration-credential-scope-and-verification.md). Provider authentication/policy failures invalidate the candidate; rate limits, timeouts, network failures and provider outages preserve the previous status for safe retry.

## OpenAI

First MVP uses an OpenAI API key owned by each tenant.

Node defaults:

| Workload                                                         | Default                  |
| ---------------------------------------------------------------- | ------------------------ |
| Intent, extraction, category, similarity classification          | `gpt-5.6-luna`           |
| Research synthesis, editorial generation, translation, rationale | `gpt-5.6-terra`          |
| Embeddings                                                       | `text-embedding-3-small` |
| Image generation/editing                                         | `gpt-image-2`            |

Models and parameters are declared per agent node in `@binflow/tools`
(`node.yaml`), validated against a code-owned allowlist, and frozen per request.
There is no silent model or credential fallback. Client customization markdown
cannot set model or effort.

Requirements:

- Structured outputs for intent, plan, category, similarity, article metadata and rationale.
- Web search only from the research node and only when project policy allows it.
- Primary/official sources prioritized for current or sensitive claims.
- Usage, provider request ID, tokens, image dimensions, cost and latency recorded.
- Stable safety identifier when supported.

The production adapter uses the Responses API with strict structured output
for article generation and translation, `/v1/embeddings` for catalog vectors,
and `/v1/images/generations` for the cover source. The image response is
converted deterministically to AVIF before artifact validation because the
Image API does not return AVIF directly.

The first pricing snapshot uses the published 2026-07-30 standard rates:
`gpt-5.6-terra` at USD 2.50/M input and USD 15/M output tokens, and
`gpt-image-2` at USD 5/M text input and USD 30/M image output tokens, plus
`text-embedding-3-small` at USD 0.02/M input tokens. Every
model call stores reported tokens and a rounded-up estimated cent value. A rate
change requires a documented pricing snapshot update; it is never fetched from
untrusted model output.

The Phase 0 credential check authenticates against the model catalog and confirms visibility of `gpt-5.6-luna`, `gpt-5.6-terra`, `text-embedding-3-small` and `gpt-image-2`. It makes no billable generation request. Structured-output, research, embedding and image capability probes are separate Phase 0 spikes and activation remains blocked until those pass.

## Telegram

Chat SDK Telegram adapter behind `MessagingGateway`. Every client notice that
carries action tokens — plan confirmation, preview ready, revision and cancel —
is a Chat SDK card so Telegram receives an inline keyboard. Worker-originated
notices use that same card renderer. Callback queries are acknowledged by the
adapter and then handled as the same `/action` ingress as typed tokens. Visible
copy never includes `/action <token>`.

Phase 0 verification calls `getMe` and `getWebhookInfo`, requires a bot identity and exact expected username, and checks that local polling is not blocked by an existing webhook. It never calls `deleteWebhook`, `setWebhook` or `sendMessage`. Onboarding later sends a test message after an authorized chat ID exists. Production additionally sets and verifies a tenant-scoped webhook and secret. Incoming updates deduplicate by bot integration and `update_id`.

Activation also requires that the normalized Telegram bot ID is not active for
any other admin/client credential or tenant.

## GitHub

### Authentication

The GitHub App private key/webhook secret are a platform registration
credential keyed by GitHub `appId`. App/client IDs are non-secret configuration.
Each project stores a separate non-secret installation binding
(`integration_connections`); installation tokens are short-lived and never
persisted. Runtime execution must load the App credential **and** installation
IDs through the requesting project's active connection — never by selecting an
arbitrary active `github-app` row. Distinct App registrations (different
`appId`) may coexist at platform scope; rotating the same App supersedes only
that `appId`.

The first pilot GitHub App is installed on `arrobabeto/webbin`. Additional
client Apps (for example Bistro) bind their own installation to their project.
Its explicitly approved registration permission ceiling is:

- Administration: read/write.
- Metadata: read.
- Contents: read/write.
- Pull requests: read/write.
- Checks: read.
- Commit statuses: read.
- Deployments: read.
- Workflows: read/write.

Actions, Actions secrets and Dependabot secrets are not granted.

Every short-lived installation token is limited to Webbin and downscoped to the current operation. Normal `create_blog_draft` permissions are:

- Metadata: read.
- Contents: read/write.
- Pull requests: read/write.
- Checks and commit statuses: read.
- Deployments: read only when needed for correlation.

Normal execution omits Administration and Workflows. They may be requested only for a separately modeled, exact admin-authorized onboarding/configuration operation with deterministic policy checks and complete audit. The model cannot choose permissions. See [ADR-0013](adr/0013-github-app-administrative-registration.md).

Phase 0 verification is read-only: it validates App identity and exact registration permissions, enumerates the configured installation to prove that its selected repository set is only `arrobabeto/webbin`, then verifies Webbin identity and `main` as default branch. The enumeration uses the narrowly approved metadata/read-only `installation_audit` token from [ADR-0014](adr/0014-integration-credential-scope-and-verification.md); it is revoked/discarded immediately. Verification never creates a branch, commit, PR or deployment. The webhook secret remains unverified until a signed delivery is observed.

Subscribed GitHub App event validation is deferred to production webhook activation, where the registered event set and signed-delivery path are checked together; Phase 0 credential verification does not claim that evidence.

### Repository operations

- Read remote production branch head.
- Create one request branch.
- Create complete files/trees with allowed paths only.
- Commit using bot identity.
- Open/update one PR.
- Read head SHA, checks, conflict state and mergeability.
- Merge only after approval service issues an internal publish command.
- Re-read an already-merged PR as a successful merge when the approved head and files still match.

The blog executor obtains an operation-enum token; callers cannot provide an
arbitrary permission map. A retry first searches for the exact request branch
and PR and verifies recorded SHAs before deciding whether a mutation remains.

Branch pattern for Webbin:

```text
bot/webbin/create-blog/<request-id>-<slug>
```

Webbin content PRs target `main`. The current local `develop` publishing skill is reference material and is not copied into Binflow.

For non-Webbin projects (`astro_orbitype` and later profiles), draft and merge
operations use the verified GitHub connection `expectedRepository` and
`defaultBranch` from enrollment — not the Webbin pilot constants.

### Webhooks/reconciliation

Production listens for installation, pull request, push and check events with signature validation. Local mode may poll. Reconciliation always confirms current state before advancing a graph.

## Vercel

Preferred preview mode is Vercel Git Integration. Onboarding confirms project/repository relationship and whether non-production branch pushes create Preview Deployments.

Phase 0 credential verification is read-only. It first calls the authenticated
user endpoint, then reads the configured project with the configured `teamId`
when present. Team projects must have `accountId = teamId`; personal projects
must have `accountId = user.id`. The project ID, Git provider, separate GitHub
`org` + `repo` fields resolving to exact `arrobabeto/webbin`, and `main`
production branch must match the immutable Webbin connection policy. It does
not create, redeploy, promote, pause or update a project. Preview behavior and
deployment/SHA correlation remain separate activation validations.

If the existing integration cannot satisfy exact preview requirements, a separately approved onboarding PR adds controlled preview CI. This PR is never combined with generated content.

The adapter stores:

- Deployment ID and status.
- Branch URL for iteration.
- Commit URL for approval.
- Git branch, commit SHA, project/team and environment.
- Relevant build error summary.

Approval is unavailable unless deployment is ready and bound to the PR head SHA.
`waitForPreview` / `waitForProduction` poll the deployments API by
`githubCommitSha` until READY or the deadline. Transient network failures and
429/5xx responses keep polling; authentication, authorization, missing project,
deployment ERROR/CANCELED, and invalid list payloads fail closed.
Merge revalidation reads the open PR, file set, combined commit status and then
squash-merges only when the approved head SHA is unchanged. A successful
revalidation returns no payload and is not a publication failure.

Preview and production reconciliation filter by the configured project/team,
Git commit SHA and target. A route check records the HTTP result without
persisting response bodies. Protected routes require the separately configured
preview-safe access mechanism during live acceptance. Production completion
evidence and Telegram publication messages use the verified public project
domain `https://webbin.com.mx`; preview messages keep the unique Vercel
deployment origin. Unique production deployment hostnames are not client-visible.

Preview and production environment variables are separate. Webbin preview must not send Web3Forms submissions to the real destination. Production publication occurs by merging Git and verifying the resulting production deployment, not by promoting an unrelated URL.

## Webbin pilot contract

Source of truth: GitHub repository `arrobabeto/webbin`.

Profile: `astro_repo`.

Content:

```text
src/content/articulos-es/<slug>.md
src/content/articulos/<slug>.md
public/images/articles/<slug>.avif
```

Routes:

```text
/es/articulos/<slug>
/articulos/<slug>
```

Rules:

- Spanish and English always share the slug.
- Spanish is the slug locale.
- English is idiomatic adaptation, including `titulo`, `seoTitulo` and
  Markdown headings. Copying Spanish titles into the English file is invalid.
- Full editorial frontmatter is required even where the raw Astro schema marks a field optional.
- Current categories are synchronized; at baseline they include `SOP` and `Web App`.
- New categories require admin approval.
- No unrelated path may enter a content PR.

Validation profile:

```text
git diff --check
PUBLIC_WEB3FORMS_ACCESS_KEY=<preview-safe-value> pnpm run build
pnpm test
pnpm run check
```

Checks run in isolated CI/Vercel rather than a general worker shell.

## Orbitype (astro_orbitype enrollment)

Profile: `astro_orbitype` (ADR-0045). Stack directory: `astro-orbitype`.

Enrollment requires a **project-scoped** Orbitype API-key credential:

- Operator pastes the API key in the dashboard enrollment flow.
- Secret material is encrypted at rest (ADR-0014 envelope); configuration may
  hold non-secret base URL / project identifiers.
- Verification is **read-only** (authenticate and confirm identity/access). It
  must not create, update, or delete CMS content during enrollment.
- Failed auth marks the candidate invalid or leaves it unverified; it never
  displaces a prior active version without a successful verify.
- The LLM never receives the API key or a generic Orbitype SQL/MCP execute tool.

Content mutations use allowlisted ports only. Tools on this profile:

- `create_blog_orbitype` (ADR-0047) — dual-write GitHub + CMS draft/publish.
- `update_menu` (ADR-0049) — versioned menu PDF on GitHub plus Orbitype page
  section href patches; Telegram PDF ingress and menu CTA discovery.

Further CMS tools remain later Phase 6 slices.

## Future WordPress

The adapter will use HTTPS, REST discovery and a revocable Application Password. Scope is posts, approved categories and blog-associated media. Pages, themes, plugins, menus, settings and unrelated media remain blocked. A separately audited Signed Preview plugin is required before the profile can be activated.
