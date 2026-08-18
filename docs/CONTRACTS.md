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

Mutable resources return `ETag: "<version>"`. A mutation requires the exact
strong ETag in `If-Match`; missing input is a validation error and stale input
is `409 conflict_error`.

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
an actor with `role: platform_owner`. A missing/expired session is
`401 authentication_error`; a valid account without enabled TOTP is
`403 authorization_error` outside the security-enrollment surface; a sensitive
mutation whose session is older than five minutes is
`403 authorization_error` with code `fresh_session_required`.

Session policy is database-backed, 12-hour expiry, one-hour refresh and
five-minute freshness. Cookie session caching is disabled so revocation is
immediate. Cookies are HTTP-only, same-site lax and secure in production.

## Core enums

```ts
type ProjectProfile =
  'astro_repo' | 'astro_orbitype' | 'nuxt_orbitype' | 'wordpress_rest';

type SupportedLocale = 'en' | 'es' | 'de';
type TranslationPolicy = 'always_translate' | 'ask_each_action';
type RiskClass = 'low' | 'medium' | 'high' | 'blocked';
type ApprovalRole = 'client' | 'admin';
type CapabilityAccess =
  'disabled' | 'client_publish' | 'admin_required' | 'admin_only';
```

Only `astro_repo` is active in the first MVP. The other enum values reserve stable domain names and must not appear as selectable, validated profiles until their phase is complete.

## Project manifest

```ts
type ProjectManifest = {
  id: string;
  projectId: string;
  version: string;
  profile: ProjectProfile;
  status: 'draft' | 'validated' | 'active' | 'superseded';
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
  enabledCapabilities: CapabilityBinding[];
};
```

Validation rules:

- `contentLocales` must be supported by Binflow and the global profile manifest.
- `requiredContentLocales` must be a subset of `contentLocales`.
- Project policy may narrow but never expand the global profile contract.
- Active manifest versions are immutable; editing creates a draft version and revalidation.
- Runs retain the manifest version with which they started.

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

`topic` is the only client-supplied field required to begin brief mode. The planner may propose optional values, but the client must confirm them before generation.

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
GET    /api/v1/requests
GET    /api/v1/requests/:requestId
POST   /api/v1/requests/:requestId/approve
POST   /api/v1/requests/:requestId/reject
POST   /api/v1/requests/:requestId/revise
POST   /api/v1/requests/:requestId/cancel
GET    /api/v1/audit
GET    /api/v1/usage
GET    /api/v1/operations/:operationId

POST   /api/v1/admin/enrollments
PATCH  /api/v1/admin/enrollments/:id
POST   /api/v1/admin/enrollments/:id/validate
POST   /api/v1/admin/enrollments/:id/activate
POST   /api/v1/admin/enrollments/:id/suspend
POST   /api/v1/admin/enrollments/:id/archive
POST   /api/v1/admin/enrollments/:id/pairing-link
POST   /api/v1/admin/integrations/:id/test
POST   /api/v1/admin/integrations/:id/rotate
POST   /api/v1/admin/enrollments/:id/catalog/sync
```

Mutation endpoints require an idempotency key and optimistic concurrency version. Transport-specific schemas will be generated from shared Zod definitions.

`GET /api/v1/session` is the minimal authenticated bridge between Better Auth
and business APIs. It returns only actor ID, email, `role: platform_owner`,
`twoFactor: true` and current freshness; it never returns a cookie, session
token, IP address or user agent.

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
| `github-app`      | platform registration plus project installation binding | credential: App/client IDs; connection: fixed Webbin repository/branch and discovered installation/repository IDs | private key and webhook secret |
| `vercel`          | project plus project connection                         | connection: project/team IDs and fixed Webbin GitHub repository/production branch                                 | access token                   |

The project-scoped legacy GitHub shape preserved by migration `0002` is revoked audit history only and is never eligible for resolution or verification.

Provider verification returns a normalized result with credential ID, kind, checked timestamp, outcome, stable error category when applicable and provider-specific evidence validated by a strict per-kind schema. Extra evidence fields reject the result before persistence/output. Raw provider payloads and messages are not part of the contract. Integration statuses are `unverified`, `active`, `invalid`, `superseded` and `revoked`.
