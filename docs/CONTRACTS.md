# Public contracts and types

This document defines stable domain-facing contracts. Exact transport representations may add metadata but must preserve these semantics.

## Versioning

- Administrative APIs use `/api/v1`.
- Tools, manifests, graphs, nodes, prompts, policies and rules carry immutable versions.
- A request version freezes all effective version identifiers.
- Breaking schema changes require a new version and migration plan; active runs continue on frozen versions.

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

## Phase 0 credential CLI

The local bootstrap interface is a public operational contract:

```text
pnpm binflow secret init
pnpm binflow scope init --tenant webbin --project webbin
pnpm binflow integration set --kind openai --tenant webbin
pnpm binflow integration set --kind telegram-admin
pnpm binflow integration set --kind telegram-client --tenant webbin
pnpm binflow integration set --kind github-app --project webbin
pnpm binflow integration set --kind vercel --project webbin
pnpm binflow integration verify --all
pnpm binflow integration list
pnpm binflow integration revoke <id>
```

Contract rules:

- `secret init` generates a random 256-bit KEK at a configured host path outside the repository and applies file mode `0600`; it never prints the key.
- `scope init` creates an idempotent Phase 0 draft tenant/project scope so credential ownership can be validated before the Phase 1 onboarding dashboard exists. It accepts keys and display names only, never credentials, and cannot activate a project.
- `integration set` requires an interactive terminal and reads secret values through non-echoed prompts. Secrets are forbidden in command arguments, environment interpolation examples and command output.
- `integration set` validates the required tenant/project scope before storing one encrypted credential version. Repeating it creates a new version; it does not silently overwrite ciphertext.
- `integration verify` resolves a credential only inside the provider adapter, performs the narrow provider health check and stores a redacted result.
- `integration list` returns identifiers, ownership, kind, alias/masked suffix, state, version and health timestamps only.
- `integration revoke <id>` is idempotent, prevents future resolution immediately and records a credential event without retaining or displaying plaintext.
- Commands return a non-zero exit status for invalid scope, insecure KEK permissions, non-interactive secret entry, provider failure or unavailable/revoked credentials.

The dashboard must reuse these application contracts rather than implement a second credential path.
