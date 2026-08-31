# Public contracts and types

This document defines stable domain-facing contracts. Exact transport representations may add metadata but must preserve these semantics.

## Versioning

- Administrative APIs use `/api/v1`.
- Tools, manifests, graphs, nodes, prompts, policies and rules carry immutable versions.
- A request version freezes all effective version identifiers.
- Breaking schema changes require a new version and migration plan; active runs continue on frozen versions.

## Administrative HTTP conventions

All `/api/v1` payloads are validated by strict shared Zod schemas. Unknown
fields are rejected. Timestamps are UTC ISO instants and identifiers are UUIDv7
unless an external provider identifier is explicitly named.

Collection responses use opaque cursor pagination:

```ts
type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
```

The default page size is 25 and the maximum is 100. Cursors are server-created,
scope-bound and cannot be used to select another tenant/project.

Errors use one stable envelope:

```ts
type ApiErrorResponse = {
  error: {
    category:
      | 'validation_error'
      | 'authentication_error'
      | 'authorization_error'
      | 'policy_denied'
      | 'conflict_error'
      | 'budget_exceeded'
      | 'credential_unavailable'
      | 'provider_retryable'
      | 'provider_final'
      | 'internal_error';
    code: string;
    message: string;
    correlationId: string;
    fieldErrors?: Record<string, string[]>;
  };
};
```

Provider bodies and native error messages never appear in this envelope.

Every `/api/v1` mutation requires `Idempotency-Key` with 16–200 printable
ASCII characters. The server binds it to actor, method, route and canonical
body hash. The same key/request returns the stored response; the same key with
a different request returns `409 conflict_error`.

Mutable resources return `ETag: "<version>"`. A mutation of an existing
resource requires the exact strong ETag in `If-Match`; create operations have
no prior version and therefore require only the idempotency key. Missing input
is a validation error and stale input is `409 conflict_error`.

Long-running administrative actions return `202`:

```ts
type AdminOperationReference = {
  operationId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  statusUrl: string;
};
```

`GET /api/v1/operations/:operationId` returns current progress, timestamps and
allowlisted result/error metadata. It never returns queued payloads or secrets.
Operation transitions are `pending → running|failed|cancelled` and
`running → succeeded|failed|cancelled`; terminal states cannot transition.
Updates require the current version, success requires 100 percent progress and
failure requires a stable error category/code.

## Administrative authentication

Nuxt exposes Better Auth under `/api/auth/**`. This namespace follows the
pinned Better Auth transport contract; it does not use the `/api/v1` error
envelope. Public sign-up, password-reset email, OTP and trusted-device bypasses
are disabled. Supported browser actions are:

```text
POST /api/auth/sign-in/email
POST /api/auth/two-factor/verify-totp
POST /api/auth/two-factor/verify-backup-code
POST /api/auth/two-factor/enable
POST /api/auth/two-factor/generate-backup-codes
GET  /api/auth/get-session
GET  /api/auth/list-sessions
POST /api/auth/revoke-session
POST /api/auth/revoke-sessions
POST /api/auth/sign-out
```

The sole account is created through:

```text
pnpm binflow auth-secret init
pnpm binflow admin bootstrap --email <email> --name <display-name>
```

The command requires an interactive terminal, reads and confirms the password
without echo, rejects a database that already contains any auth user and never
accepts a password argument. Runtime `/sign-up/email` always rejects.

`auth-secret init` creates the independent high-entropy Better Auth secret in a
new regular `0600` file outside the repository. It prints only the path and
refuses to overwrite an existing file.

Fastify resolves the Better Auth cookie server-side for `/api/v1/**` and derives
an actor with `role: platform_owner`. A missing/expired/idle session is
`401 authentication_error`; a valid account without enabled TOTP is
`403 authorization_error` outside the security-enrollment surface. Protected
operations do not have a separate five-minute freshness failure.

Session policy is database-backed, rolling 30-minute inactivity expiry and
at-most-once-per-minute refresh. Cookie session caching is disabled so
revocation is immediate. Cookies are HTTP-only, same-site lax and secure in
production. The browser signs out at the same idle boundary and revalidates
restored/foreground navigation against the server.

## Core enums

```ts
type ProjectProfile =
  'astro_repo' | 'astro_orbitype' | 'nuxt_orbitype' | 'wordpress_rest';

type SupportedLocale = 'en' | 'es' | 'de';
type TranslationPolicy = 'always_translate' | 'ask_each_action' | 'none';
type RiskClass = 'low' | 'medium' | 'high' | 'blocked';
type ApprovalRole = 'client' | 'admin';
type CapabilityAccess =
  'disabled' | 'client_publish' | 'admin_required' | 'admin_only';
```

Only `astro_repo` was active in the first MVP. Post-MVP, `astro_orbitype` is an
accepted selectable profile for enrollment (ADR-0045). `nuxt_orbitype` and
`wordpress_rest` remain reserved names until their phases complete.

## Project manifest

```ts
type ProjectManifest = {
  id: string;
  projectId: string;
  version: number;
  profile: ProjectProfile;
  status: 'draft' | 'validated' | 'active' | 'superseded';
  globalProfileVersion: string;
  conversationLocale: SupportedLocale;
  contentLocales: SupportedLocale[];
  defaultContentLocale: SupportedLocale;
  requiredContentLocales: SupportedLocale[];
  slugLocale: SupportedLocale;
  translationPolicy: TranslationPolicy;
  repository?: {
    owner: string;
    name: string;
    productionBranch: string;
    branchPattern: string;
    githubInstallationId: string;
  };
  deployment?: {
    provider: 'vercel';
    projectId: string;
    teamId?: string;
    previewMode: 'git_integration' | 'ci' | 'api';
    protectionMode: 'vercel_auth' | 'share_link' | 'public';
    /** Client-visible live origin (ADR-0048); from enrollment productionDomain. */
    productionOrigin?: string;
  };
  content: {
    source: 'github' | 'orbitype' | 'wordpress';
    collections: Record<string, unknown>;
    categories: string[];
    editablePaths: string[];
    blockedPaths: string[];
  };
  validationProfileId: string;
  rulesVersion: string;
  graphVersion: string;
  budgetPolicy: ProjectBudgetPolicy;
  enabledCapabilities: CapabilityBinding[];
};

type ProjectBudgetPolicy = {
  maxRequestsPerDay: number;
  maxModelCallsPerRequest: number;
  maxTokensPerRequest: number;
  maxEstimatedCostCentsPerRequest: number;
  maxEstimatedCostCentsPerDay: number;
};
```

Validation rules:

- `contentLocales` must be supported by Binflow and the global profile manifest.
  The platform catalog is exactly `en`, `es` and `de` (ADR-0011 / ADR-0046).
  An enrollment may enable one, two or three of those locales.
- `requiredContentLocales` must be a subset of `contentLocales`.
- When `contentLocales` has length 1, `translationPolicy` must be `none`.
  When length is greater than 1, policy is `always_translate` or
  `ask_each_action`.
- Project policy may narrow but never expand the global profile contract.
- Active manifest versions are immutable; editing creates a draft version and revalidation.
- Runs retain the manifest version with which they started.
- Counts and USD-cent budget fields are positive integers; the daily estimated
  cost ceiling must be greater than or equal to the per-request ceiling.
- Saving enrollment configuration does not create a manifest. Successful
  deterministic enrollment validation creates or reuses one validated version.
- Revalidation reuses an identical dependency fingerprint and otherwise creates
  the next project-local integer version while superseding only the previous
  non-active version.
- Webbin accepts exactly `es` and `en`, with `es` as default/slug locale and
  `always_translate`; `de`, monolingual configs and `none` / `ask_each_action`
  are rejected by the pilot overlay rather than silently ignored.
- The generated English article must adapt `titulo`, `seoTitulo`, `descripcion`,
  `imagenAlt`, keywords, FAQ questions and Markdown headings. Identical Spanish
  strings in the English locale are invalid.
- The Webbin pilot production origin is `https://webbin.com.mx`. Client-visible
  production URLs use that origin.

## Capability definition

```ts
type ToolDefinition<Input = unknown, Output = unknown> = {
  id: string;
  version: string;
  inputSchema: object;
  outputSchema: object;
  executorId: string;
  allowedProfiles: ProjectProfile[];
  riskClass: RiskClass;
  requiredPermissions: string[];
  requiresPreview: boolean;
  approvalPolicyId: string;
  timeoutSeconds: number;
  retryPolicy: {
    maxAttempts: number;
    retryableErrors: string[];
  };
  budgetPolicy: {
    maxModelCalls: number;
    maxTokens?: number;
    maxEstimatedCostUsd?: number;
  };
};
```

The first immutable registry entry is `create_blog_draft@1` with executor
`workflow.create_blog@1`, profile `astro_repo`, medium risk, preview required,
client publication access and deterministic conditional admin approval for a
new category. Project configuration cannot override its schemas, executor,
permissions, timeout, retries or budget. It can only bind the exact definition
through a validated manifest.

`PUT /api/v1/projects/:projectId/capabilities` accepts
`{ bindings: CapabilityBinding[] }` and:

1. Rejects unknown registry bindings (`capability_binding_not_allowed`).
2. Rejects bindings whose `capability_definitions` row is missing
   (`capability_definition_missing` — apply migrations first).
3. Rejects bindings when `projects.profile` is not in the definition’s
   `allowedProfiles` (`capability_profile_incompatible`).
4. Requires at least one non-disabled binding and a validated/active manifest.

Enrollment list/detail responses include `projectProfile` (from `projects.profile`)
so the Tools assignment UI can filter compatible clients by stack.

```ts
type CapabilityCatalogItem = {
  id: 'create_blog_draft';
  version: 1;
  command: '/create_blog';
  displayName: 'Create blog';
  access: CapabilityAccess;
  enabled: boolean;
  requiresPreview: true;
  riskClass: 'medium';
};
```

The immutable registry includes **`create_blog_orbitype@1`** with executor
`workflow.create_blog_orbitype@1`, profile `astro_orbitype`, medium risk, preview
required, and `allowedProfiles: ['astro_orbitype']`. Publication uses separate
GitHub and Orbitype writer nodes (ADR-0047). Input shape matches
`createBlogDraftInputSchema` modes (`brief` | `draft`).

The immutable registry includes **`create_project_astro@1`** with executor
`workflow.create_project@1`, profile `astro_repo`, medium risk, preview
required, and client-only publication approval (ADR-0034). Legacy
`create_project_draft@1` remains in the database append-only history.

Graph versions for queued runs resolve from the declarative tool catalog
(`tool.yaml` → `graphVersion`) via ADR-0038; worker dispatch resolves
`executorId` through `packages/workflows/src/capability-runtimes.ts` (fail-closed).

## `create_project_astro`

Telegram command: `/create_project`.

See `docs/specs/create-project-astro.md`, ADR-0034, ADR-0035, ADR-0036 and
ADR-0037. Structure (paths, headings, enums) is manifest-driven. Customization
supplies editorial style and optional allowlisted `content_schema` fields
collected in `NEEDS_INPUT` before plan confirmation. Base facts: `name`,
`fecha` (`YYYY-MM`), `projectDescription`. Graph `@4` runs `read_project_url`
before generate. Covers render as AVIF. Closed-fact metadata merges
deterministically onto `project_bundle.v1` after generate.

Intermediate artifact: validated `project_bundle.v1` JSON rendered to manifest
collection paths with optional cover under `content.portfolio.imageDirectory`.

## `delete_project_astro`

Telegram command: `/delete_project`.

See `docs/specs/delete-project.md` and ADR-0040. Destructive portfolio deletion
by title or URL; admin-only publication; no preview deploy. Input schema:
`deleteProjectAstroInputSchema` (`collect` | `execute` modes). Policy:
`webbin-project-deletion@1`.

## `delete_blog_draft`

Telegram command: `/delete_blog`.

See `docs/specs/delete-blog-draft.md` and ADR-0040 / ADR-0041. Input schema:
`deleteBlogDraftInputSchema` (`collect` | `execute` modes). Policy:
`webbin-blog-deletion@1`.

## `update_menu`

Telegram command: `/update_menu`.

See `docs/specs/update-menu.md` and ADR-0049. Profile `astro_orbitype` only.
Input schema: `updateMenuInputSchema` (`collect` | `execute` modes). Telegram
ingress accepts `documentArtifactKey` (PDF, max 10 MB). Reply actions:
`toggle_menu_cta`, `confirm_menu_selection`, then generic `confirm_plan` at plan
confirm. `BlogFile.mime` includes `application/pdf` for versioned menu artifacts
under `public/documents/*.pdf`.

```ts
type UpdateMenuInput =
  | {
      mode: 'collect';
      projectId: string;
      collectionStep: 'await_pdf' | 'select_ctas' | 'ready';
      pdfArtifactKey?: string;
      selectedCtaKeys: string[];
      discoveredCtas: MenuCtaCandidate[];
      /* … */
    }
  | {
      mode: 'execute';
      projectId: string;
      pdfArtifactKey: string;
      menuPdfPublicPath: string;
      menuPdfPublicUrl: string;
      selectedCtaKeys: string[];
    };
```

## `edit_text`

Telegram command: `/edit_text`.

See `docs/specs/edit-text.md` and ADR-0051. Profile `astro_orbitype` only.
Input schema: `editTextInputSchema` (`collect` | `execute` modes). Reply actions:
`pick_text_locale`, `pick_text_target`, `confirm_text_target`, `confirm_text_plan`,
then generic `confirm_plan` is not used (plan confirm uses `confirm_text_plan`).
Preview actions: `approve_preview`, `cancel` only (no revision).

```ts
type EditTextInput =
  | {
      mode: 'collect';
      projectId: string;
      collectionStep:
        | 'await_locale'
        | 'await_target'
        | 'disambiguate'
        | 'confirm_target'
        | 'await_replacement'
        | 'ready';
      contentLocale?: SupportedLocale;
      targetKey?: string;
      newValue?: string;
      discoveredTargets: TextEditCandidate[];
      /* … */
    }
  | {
      mode: 'execute';
      projectId: string;
      contentLocale: SupportedLocale;
      targetKey: string;
      newValue: string;
    };
```

## `edit_image`

Telegram command: `/edit_image`.

See `docs/specs/edit-image.md` and ADR-0052. Profile `astro_orbitype` only.
Input schema: `editImageInputSchema` (`collect` | `execute` modes). Reply actions:
`pick_image_target`, `confirm_image_target`, `reject_image_target`,
`confirm_image_plan`. Optional `photoUrl` on `TelegramReply` for current-image
preview during target confirm. Preview actions: `approve_preview`, `cancel` only
(no revision). Admin always required after client approve.

```ts
type EditImageInput =
  | {
      mode: 'collect';
      projectId: string;
      collectionStep:
        | 'await_target'
        | 'disambiguate'
        | 'confirm_target'
        | 'await_replacement'
        | 'ready';
      targetKey?: string;
      replacementArtifactKey?: string;
      replacementMime?: string;
      replacementSourceUrl?: string;
      discoveredTargets: ImageEditCandidate[];
      /* … */
    }
  | {
      mode: 'execute';
      projectId: string;
      targetKey: string;
      replacementArtifactKey: string;
      replacementMime: string;
      replacementSourceUrl?: string;
    };
```

```ts
type CreateProjectAstroInput =
  | {
      mode: 'collect';
      projectId: string;
      closedFacts: Record<string, unknown>;
      messages: string[];
      collectionComplete?: boolean;
      publicationIntent?: 'draft' | 'publish';
    }
  | {
      mode: 'brief';
      projectId: string;
      brief: string;
      closedFacts?: Record<string, unknown>;
      publicationIntent?: 'draft' | 'publish';
      image?: { mode: 'omit' | 'generate' | 'provided'; sourcePath?: string };
      url?: string;
      tipo?: string;
      estado?: string;
      fecha?: string;
      destacada?: boolean;
      confidencial?: boolean;
      stack?: string[];
      sourceLocale?: SupportedLocale;
      clientProfile?: string;
      notes?: string;
    }
  | {
      mode: 'structured';
      projectId: string;
      bundle: GeneratedProjectBundle;
      publicationIntent?: 'draft' | 'publish';
      url?: string;
      fecha?: string;
      destacada?: boolean;
      confidencial?: boolean;
      notes?: string;
    }
  | {
      mode: 'revision';
      projectId: string;
      feedback: string;
    };
```

Manifest portfolio extension:

```ts
type ManifestPortfolio = {
  collections: Partial<Record<SupportedLocale, { directory: string; routePrefix: string }>>;
  editablePaths: string[];
  frontmatterFields: string[];
  requiredFrontmatter: string[];
  imageDirectory: string;
  sectionHeadings: Partial<
    Record<
      SupportedLocale,
      { challenge: string; solution: string; outcome: string }
    >
  >;
  enumFields?: Record<string, readonly string[]>;
};
```

Publication with `publicationIntent: 'publish'` requires `url` on the bundle.

## `create_blog_draft`

Telegram command: `/create_blog`.

```ts
type SourceReference = {
  kind: 'url' | 'telegram_document' | 'project_content';
  value: string;
};

type CreateBlogDraftInput =
  | {
      mode: 'brief';
      projectId: string;
      topic: string;
      context?: string;
      objective?: string;
      audience?: string;
      category?: string;
      sourceLocale?: SupportedLocale;
      sources?: SourceReference[];
      keywords?: string[];
      internalLinks?: string[];
      imageAssetId?: string;
      publicationDate?: string;
      notes?: string;
    }
  | {
      mode: 'draft';
      projectId: string;
      title: string;
      content: string;
      category?: string;
      sourceLocale?: SupportedLocale;
      sources?: SourceReference[];
      imageAssetId?: string;
      publicationDate?: string;
      notes?: string;
    };
```

`topic` is required on the brief-mode schema (≤500 characters). For Telegram
ingress (ADR-0031), a short message becomes `topic` only; a longer message
(≤10 000) is stored entirely in `context` with a provisional localized `topic`.
The executor’s `interpret_brief` stage proposes the durable topic from
`context` before similarity. The planner may still propose optional fields
(`objective`, `audience`, …); the client must confirm the plan before
generation.

```ts
type CategoryDecision =
  | { kind: 'existing'; category: string }
  | {
      kind: 'likely_typo';
      supplied: string;
      suggested: string;
      confidence: number;
    }
  | { kind: 'new'; proposed: string };

type SimilarityDecision =
  | { level: 'novel'; candidates: [] }
  | {
      level: 'related_expansion';
      candidates: ContentCandidate[];
      distinctIntent: string;
    }
  | {
      level: 'high_overlap';
      candidates: ContentCandidate[];
      recommendation: string;
    };
```

```ts
type CreateBlogDraftOutput = {
  requestId: string;
  requestVersionId: string;
  slug: string;
  locales: SupportedLocale[];
  files: string[];
  branch: string;
  pullRequestUrl: string;
  headCommitSha: string;
  previewDeploymentId: string;
  previewUrls: Record<string, string>;
  checks: Array<{
    name: string;
    status: 'passed' | 'failed' | 'pending';
  }>;
  approvalStatus: string;
  estimatedModelCostUsd: number;
};
```

Preview URLs use the unique Vercel deployment origin. Production publication
URLs use the verified public project domain, not a `*.vercel.app` hostname.

## Policy decision

```ts
type PolicyDecision = {
  allowed: boolean;
  reasons: string[];
  requiredApprovals: ApprovalRole[];
  requiresPreview: boolean;
  allowedPaths: string[];
  allowedFields?: string[];
  effectiveRisk: RiskClass;
};
```

For first-MVP Webbin blogs:

- Existing or normalized category: client approval.
- New category: client and admin approval.
- Preview: always required.
- Any file outside the manifest: blocked.

## Approval binding

```ts
type ApprovalBinding = {
  id: string;
  requestId: string;
  requestVersionId: string;
  projectId: string;
  role: ApprovalRole;
  artifactKind: 'git_preview' | 'cms_version' | 'wordpress_preview';
  artifactId: string;
  headCommitSha?: string;
  deploymentId?: string;
  contentVersion?: string;
  approverUserId: string;
  approvedAt: string;
  expiresAt: string;
};
```

Any artifact identifier change invalidates the approval. Duplicate approval actions return the current decision without repeating effects.

Client action tokens support `approve_preview`, `request_revision`,
`confirm_revision_plan`, `adjust_revision_plan`, `cancel_revision`, `reject`
and `cancel` after preview or revision-plan gates.

Admin action tokens (ADR-0050) support `approve_publish` and `reject` for requests
in `AWAITING_ADMIN_APPROVAL` only. Tokens are opaque, hashed, expire within the
action TTL, and bind to one request version, PR head SHA, preview deployment,
and artifact. The admin Telegram surface presents them as inline **Approve** /
**Reject** buttons on the `admin_approval_required` card; ingress is still
`text: "/action <token>"` from `callback_query` or typed fallback. Only the
paired `adminNotificationTargets` identity may consume admin tokens.

The Telegram client surface presents client tokens as inline buttons on every
decision step, including worker-originated preview notices and revision-plan
notices; the ingress contract is still `text: "/action <token>"` whether the
client tapped a button or typed the fallback command. Visible Telegram copy
never includes the `/action` form.

Publication resume signals use the same stable request/request-version
identity as generation and add a code-owned reason: `execute`, `publish`,
`reconcile`, or `restore_orbitype_preview` (compensating restore of temporary
preview CMS patches for `edit_image` / `edit_text`). Queue payloads contain no
provider credential, generated body or attachment bytes.

## Generated rationale and model call

```ts
type GeneratedRationale = {
  summary: string;
  decision: string;
  evidenceRefs: string[];
  alternativesConsidered: string[];
  confidence?: number;
  limitations: string[];
};
```

Model-call records include provider, model, parameters, node/prompt versions, redacted input hash, structured output, generated rationale, provider request ID, token usage, cost, latency, error and retry metadata. They do not claim to contain private chain-of-thought.

## Administrative API surface

```text
GET    /api/v1/health
GET    /api/v1/session
GET    /api/v1/projects
GET    /api/v1/projects/:projectId
GET    /api/v1/projects/:projectId/capabilities
PUT    /api/v1/projects/:projectId/capabilities
GET    /api/v1/tools/:toolId/assignments
GET    /api/v1/requests?projectId&needsAdminApproval&limit&cursor
GET    /api/v1/requests/:requestId
POST   /api/v1/requests/:requestId/approve
POST   /api/v1/requests/:requestId/reject
POST   /api/v1/requests/:requestId/revise
POST   /api/v1/requests/:requestId/cancel
POST   /api/v1/requests/:requestId/messages
GET    /api/v1/requests/:requestId/message-target
GET    /api/v1/audit
GET    /api/v1/usage
GET    /api/v1/operations/:operationId
GET    /api/v1/readiness

GET    /api/v1/admin/enrollments
GET    /api/v1/admin/enrollments/:id
GET    /api/v1/admin/enrollments/:id/manifest
GET    /api/v1/admin/enrollments/:id/message-target
POST   /api/v1/admin/enrollments/:id/messages
POST   /api/v1/admin/enrollments
PATCH  /api/v1/admin/enrollments/:id
POST   /api/v1/admin/enrollments/:id/validate
POST   /api/v1/admin/enrollments/:id/activate
POST   /api/v1/admin/enrollments/:id/suspend
POST   /api/v1/admin/enrollments/:id/archive
POST   /api/v1/admin/enrollments/:id/pairing-link
GET    /api/v1/admin/integrations
POST   /api/v1/admin/integrations
POST   /api/v1/admin/integrations/:id/verify
POST   /api/v1/admin/integrations/:id/revoke
POST   /api/v1/admin/enrollments/:id/catalog/sync
POST   /api/v1/admin/telegram/pairing-link
GET    /api/v1/admin/telegram/target
```

`POST /api/v1/requests/:requestId/reject` transitions the request to
**`CANCELLED`** and enqueues **`request.cancelled`** to the client (ADR-0050).
It no longer sets `REVISION_REQUESTED` / `approvalStatus: admin_rejected`.

`POST /api/v1/admin/enrollments/:id/messages` and
`POST /api/v1/requests/:requestId/messages` accept
`{ "message": "<plain text>" }` (1–2000 characters after trim), require a fresh
TOTP session and `Idempotency-Key`, and enqueue `client.notification_requested`
(ADR-0043). **Enrollment-scoped** send remains. Request-scoped send after
`admin_rejected` is deprecated for new rejects (ADR-0050). Responses are
`{ "queued": true, "notificationType": "admin.direct_message" | "admin.request_message" }`.

`GET /api/v1/admin/enrollments/:id/message-target` and
`GET /api/v1/requests/:requestId/message-target` return a redacted channel
summary:
`clientName`, `tenantKey`, `projectKey`, `botUsername`, `paired` — never chat
IDs, tokens or ciphertext.

Module 7 implements a redacted request projection with request ID,
tenant/project, `clientName`, `clientKey`, `create_blog_draft` capability, state,
current version, topic, timestamps, optimistic concurrency revision, and
nullable `approvalStatus` from `terminalResult` when present (for example
`approved_for_publish`, `admin_rejected`, `published`).
`GET /api/v1/requests` is a cursor page. Query: optional `projectId`, optional
`needsAdminApproval` (`true` = `AWAITING_ADMIN_APPROVAL` only, `false` =
every other state), `limit` in `{10,30,50}` (default 10), optional opaque
`cursor` of `{ updatedAt, id }` ordered `updatedAt DESC, id DESC`. `nextCursor`
is null when no further batch exists. Detail also includes:

- `stages`: append-only workflow checkpoints for the current request version.
  Each entry has `sequence`, `node`, `createdAt` and a redacted `summary`
  derived only from allowlisted checkpoint state (`requestState`,
  `errorCategory`). No credentials, chain-of-thought or raw JSON dumps.
- `failure`: when the request stops with an error, `{ category, message, node }`
  from `terminalResult` (`errorCategory`, `errorMessage`, `failedNode`) or
  `null` when no failure is recorded.

The implemented kernel states are `RECEIVED`, `NEEDS_INPUT`,
`AWAITING_PLAN_CONFIRMATION`, `QUEUED`, `CANCELLED` and `FAILED_FINAL`;
Module 8 adds execution/publication states.

`POST /api/v1/requests/:requestId/cancel` requires `If-Match` and an
idempotency key. Telegram actions call the same application service with a
resolved channel actor and an opaque, single-use action token.

A successful dashboard cancellation also enqueues one durable
`client.notification_requested` outbox event in the same transaction, so the
client's Telegram conversation learns the request is terminal (ADR-0027). The
event is keyed by request and event version, so an idempotent replay of the
cancel call returns the stored response without enqueuing a second notice. A
request whose conversation locale cannot be resolved commits the cancellation
without an event. Client-initiated `/cancel` enqueues nothing because it already
answers in-thread.

The transport-neutral Telegram ingress input is `{ botId, updateId,
externalUserId, chatId, text, receivedAt }`. It accepts direct messages only,
deduplicates by bot/update and returns localized reply intents. It never accepts
tenant/project IDs supplied by an update.

Telegram transport dispatch preserves the complete command text. Chat SDK
slash events are reconstructed as `/<command> [arguments]` and sent through the
same ingress service as ordinary direct messages; registering only a direct
message handler is not conformant because Telegram classifies `/start` and the
tool commands separately.

Mutation endpoints require an idempotency key and optimistic concurrency version. Transport-specific schemas will be generated from shared Zod definitions.

The admin Telegram pairing-link endpoint requires a non-idle, TOTP-verified owner
session and an idempotency key. It returns plaintext only once as
`{ pairingUrl, expiresAt }`; persistence stores only the token hash. The target
projection returns only bot username, paired Telegram user/chat IDs, status and
timestamps. It never returns bot tokens or pairing-token material.

Enrollment creation and update use strict shared schemas. Supported locale
values are `en`, `es` and `de`; `astro_repo` is the only profile. Creation
accepts tenant/project keys and adopts the matching Phase 0 draft scope.
Responses include `version` and `ETag: "<version>"`. Existing-resource
mutations require `Idempotency-Key` and `If-Match: "<version>"`; creation has
no `If-Match`. Missing inputs are validation errors and a stale version is a
conflict.

`POST .../validate` synchronously records immutable current named validation
attempts; later request-bound external scans/probes use durable operations.
Successful delivery of the client bot's pairing response records
`telegram_test_send` and transitions the aggregate to `active` when the
ADR-0025 activation checks remain current. `POST .../activate` remains an
idempotent readiness/reconciliation surface and fails with `policy_denied`
while those checks are missing. A pairing-link response contains plaintext only on its
first successful delivery. Its idempotency record stores a redacted delivery
receipt; replay returns `409 pairing_link_already_delivered`, and persistence or
later reads never expose the token.

`GET .../:id/manifest` returns the latest validated project manifest or `null`
together with the code-owned global-profile summary used by the dashboard. It
contains no provider credential configuration. Successful `POST .../validate`
includes the `project_manifest` attempt with allowlisted `manifestId`, integer
`manifestVersion`, `globalProfileVersion` and dependency `fingerprint`
evidence. The enrollment draft accepts `defaultContentLocale` and a strict
`budgetPolicy`; those values are not operational until manifest validation.

`GET /api/v1/session` is the minimal authenticated bridge between Better Auth
and business APIs. It returns only actor ID, email, `role: platform_owner`,
`twoFactor: true` and current non-idle status; it never returns a cookie, session
token, IP address or user agent.

Integration creation accepts one strict discriminated provider payload. OpenAI
requires tenant key/API key; client Telegram requires tenant key/token/expected
username; admin Telegram requires token/expected username; GitHub App requires
the Webbin tenant/project keys, App/client IDs, PEM and webhook secret; Vercel
requires the Webbin tenant/project keys, token, project ID and optional team ID.
Unknown or inapplicable fields are rejected. The response is a redacted
credential summary and never includes provider configuration, evidence,
ciphertext or a secret-derived value other than the four-character mask.

`POST .../:id/verify` and `POST .../:id/revoke` require `If-Match` over the
credential `revision`. Verification returns the redacted credential plus the
stable verification outcome/error category; evidence remains server-side.
Rotation posts a new candidate with the same kind/scope. Revocation is explicit;
there is no endpoint that retrieves or decrypts an existing secret.

## Phase 0 credential CLI

The local bootstrap interface is a public operational contract:

```text
pnpm binflow secret init
pnpm binflow scope init --tenant webbin --project webbin
pnpm binflow integration set --kind openai --tenant webbin
pnpm binflow integration set --kind telegram-admin
pnpm binflow integration set --kind telegram-client --tenant webbin
pnpm binflow integration set --kind github-app --tenant webbin --project webbin
pnpm binflow integration set --kind vercel --tenant webbin --project webbin
pnpm binflow integration verify --all
pnpm binflow integration verify <credential-id>
pnpm binflow integration list
pnpm binflow integration revoke <id>
```

Contract rules:

- `secret init` generates a random 256-bit KEK at a configured host path outside the repository and applies file mode `0600`; it never prints the key.
- `scope init` creates an idempotent Phase 0 draft tenant/project scope so credential ownership can be validated before the Phase 1 onboarding dashboard exists. It accepts keys and display names only, never credentials, and cannot activate a project.
- `integration set` requires an interactive terminal and reads secret values through non-echoed prompts. The multiline GitHub App PEM is the sole file-import exception: the operator selects its path interactively, and Binflow requires a regular `0600` file outside the repository with a bounded size. Secrets are forbidden in command arguments, environment interpolation examples and command output.
- `integration set` validates the required tenant/project scope before storing one encrypted credential version. Project-scoped commands require both tenant and project keys so duplicate project keys across tenants cannot resolve ambiguously. Repeating it creates a new version; it does not silently overwrite ciphertext.
- `integration set` creates an `unverified` candidate. GitHub App registration material is platform-scoped even though `--project webbin` validates and creates its separate non-secret Webbin installation binding.
- In Phase 0, GitHub/Vercel Webbin bindings are authorized only for internal tenant/project keys `webbin/webbin`; provider repository/branch values are fixed application policy. A project credential and connection must have identical owner scope, their kinds must match, and one credential version has at most one connection.
- `integration verify <credential-id>` checks exactly one `unverified`, `invalid` or `active` credential; `revoked` and `superseded` versions are unavailable. `integration verify --all` checks every current active credential plus the newest unverified candidate for each owner scope and kind; ordering is stable by kind, owner scope and version.
- `integration verify` resolves and parses plaintext only inside the provider adapter, performs the read-only provider check and stores an allowlisted redacted result. It never changes Telegram webhook state, sends a Telegram message or mutates Webbin.
- Successful candidate verification atomically sets it `active` and the previous active version `superseded`. An older candidate cannot replace a newer active version. Permanent failure sets the candidate `invalid`; retryable failure preserves its state. A failed candidate never replaces the previous active credential.
- Attempt results are monotonic by `checkedAt`; a late older result is audited and discarded. Deterministic activation rejection returns a redacted failed result and does not stop `--all`, while a concurrent revoke remains unavailable.
- `--all` continues after individual failures, prints one redacted row per selected credential and exits non-zero when any check fails.
- `integration list` returns identifiers, ownership, kind, alias/masked suffix, state, version and health timestamps only.
- `integration revoke <id>` is idempotent, prevents future resolution immediately and records a credential event without retaining or displaying plaintext.
- Commands return a non-zero exit status for invalid scope, insecure KEK permissions, non-interactive secret entry, provider failure or unavailable/revoked credentials.

The dashboard must reuse these application contracts rather than implement a second credential path.

Credential ownership and payload split:

| Kind              | Owner scope                                             | Non-secret configuration                                                                                          | Encrypted bundle               |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `openai`          | tenant                                                  | required Phase 0 model set/version                                                                                | API key                        |
| `telegram-admin`  | platform                                                | expected bot username, role                                                                                       | bot token                      |
| `telegram-client` | tenant                                                  | expected bot username, role                                                                                       | bot token                      |
| `github-app`      | platform registration (keyed by GitHub `appId`) plus project installation binding | credential: App/client IDs; connection: expected repository/branch and discovered installation/repository IDs for that project | private key and webhook secret |
| `vercel`          | project plus project connection                         | connection: project/team IDs and fixed GitHub repository/production branch                                        | access token                   |
| `orbitype-api`    | project                                                 | optional non-secret base URL / project identifiers                                                                | API key                        |

The project-scoped legacy GitHub shape preserved by migration `0002` is revoked audit history only and is never eligible for resolution or verification.

Provider verification returns a normalized result with credential ID, kind, checked timestamp, outcome, stable error category when applicable and provider-specific evidence validated by a strict per-kind schema. Extra evidence fields reject the result before persistence/output. Raw provider payloads and messages are not part of the contract. Integration statuses are `unverified`, `active`, `invalid`, `superseded` and `revoked`.
