# Client onboarding

Operator step-by-step for dashboard enrollment lives in
[ENROLLMENT.md](ENROLLMENT.md) (active stacks vs first client on a newly
shipped stack). This document owns the product lifecycle and validation
model.

For **new client sites** built to be operated by Binflow later, follow the
[Editable Surface Contract](guides/editable-surface-contract.md) (ADR-0058)
before the first content capability: ship a Surface Inventory and storefront
markers so tools can allowlist declared fields instead of reverse-engineering
the live site.

## Model

Onboarding is administrator-managed and resumable. The first MVP relationship is:

```text
one tenant → one project → one client bot → owner (+ optional Piloter)
```

The data model is multi-tenant-ready. Multiple projects per enrollment, or more
than one Piloter / additional client users beyond owner + optional Piloter,
remain out of scope until documented (ADR-0057).

## Lifecycle

```text
DRAFT
→ CONFIGURING
→ VALIDATING
→ VALIDATION_FAILED
→ READY_FOR_PAIRING
→ PAIRING_PENDING
→ ACTIVE
```

Additional states: `REVALIDATION_REQUIRED`, `SUSPENDED`, `ARCHIVED`.

- No partial activation.
- Profile change suspends the enrollment and requires full revalidation.
- Credential rotation marks affected checks stale and may require revalidation.
- Archive disables webhooks/polling and operational credentials while preserving audit.

## Wizard

Until the Phase 1 dashboard wizard is available, the Phase 0 interactive CLI may bootstrap and verify integration credentials through the same SecretsProvider/application contracts. CLI-created records remain tenant/project scoped and become manageable from the dashboard; this is not a separate storage path.

### 1. Client

- Display name, key, contact, timezone and status.
- Client conversation locale: English, Spanish or German.

### 2. Technical profile

- First MVP: `astro_repo` only.
- Post-MVP (ADR-0045): `astro_orbitype` is also selectable for new enrollments.
  Activation requires the usual GitHub, Vercel, OpenAI and Telegram client
  checks **plus** a verified Orbitype API-key credential. Capability bindings
  may be empty at activation; tools are assigned later.
- Post-MVP (ADR-0059): `shopify_liquid` is selectable for Shopify Liquid theme
  enrollments. Activation requires GitHub (theme repo), OpenAI, Telegram
  client, and `productionDomain`. **No** Vercel or Shopify Admin API in v1.
  Empty capability catalog is allowed at activation. Surface inventory is
  recommended (ADR-0058) but not a Validate blocker.
- Production domain and optional preview domain expectations. For Webbin the
  client-visible live origin is `https://webbin.com.mx`.

### 3. Content and locale contract

- Content/default/required/slug locales constrained by the global manifest.
- Platform catalog is always English, Spanish and German (ADR-0046). Each
  enrollment selects a non-empty subset; monolingual projects are allowed.
- Translation policy: `always_translate` or `ask_each_action` when two or more
  content locales are enabled; `none` when exactly one is enabled.
- Request/day, model-call/request, token/request and estimated USD-cent
  request/day budgets.
- Editorial voice, audience, prohibited claims and research policy.
- Categories and internal-link rules.

For Webbin: Spanish is the default/source and slug locale; Spanish and English
are the exact required content locales; translation is always enabled. German
and per-action translation selection are rejected by the pilot manifest.

### 4. Client Telegram bot

- Bot token capture into SecretsProvider.
- `getMe`, username and transport validation.
- Local polling or production webhook configuration.
- One test message to an admin-controlled chat before activation.

The first item is the read-only credential check. Webhook configuration and the test message are later activation validations and are never side effects of `integration verify`.

The global admin bot is configured under platform settings, not separately per client.

### 5. OpenAI

- Tenant-owned key capture and masking.
- Test configured model access for classification, editorial generation, embeddings and images.
- Set node models, reasoning/quality defaults and request/day cost budgets.
- No fallback to a platform key.

### 6. GitHub

- Select approved GitHub App installation and repository.
- Validate repository identity, production branch and required permissions.
- Read manifest paths/schema/rules.
- Create and remove a reversible test branch/artifact.

Credential verification performs only the first read-only identity/permission checks. The reversible branch/artifact probe is a separate, explicitly admin-authorized activation validation and is forbidden while Webbin is in reference-only mode.

### 7. Vercel

- Select project/team and validate repository mapping.
- Confirm preview mode and deployment/head SHA correlation.
- Confirm preview protection and environment isolation.
- Confirm side-effect services are disabled or use test credentials.

The first item begins with the read-only credential/project check. Preview
creation and deployment/SHA correlation are later activation validations and
are not side effects of `integration verify`.

### 8. Manifest and capabilities

- Create project manifest version from global `astro_repo` contract.
- Bind `create_blog_draft`, access and approval policy.
- Show effective allowed/blocked paths and required validations.
- Validate that no project setting expands global capability scope.

Manifest validation reads current verified GitHub/Vercel binding identities,
materializes an immutable locale and budget snapshot, and records the exact
manifest fingerprint/version as enrollment evidence. An unchanged fingerprint
is reused; a changed draft creates the next version. Capability binding is
materialized from the code-owned registry in the same validation transaction.
Projects may bind any registered capability version with an allowed access level
(`disabled`, `client_publish`, `admin_required`, `admin_only`). A model cannot
invent executors. Client style for a tool is supplied separately via
customization markdown (ADR-0030). The named `capability_catalog` validation
evidence must match the manifest and binding snapshot before activation.

### 9. Content catalog

- Full source scan.
- Normalize bilingual canonical groups, categories and source revisions.
- Generate embeddings and verify counts.
- Report schema/content exceptions without silently ignoring them.

### 10. End-to-end reversible validation

- Execute an isolated test request that creates a branch, artifact, checks and preview.
- Confirm preview URL and side-effect safety.
- Remove/close the test artifact and verify cleanup.
- Validate audit, usage and notifications.

### 11. Pairing

- Create the primary client (owner) user.
- Generate one-time 24-hour owner deep link.
- Ensure the local worker has discovered the active client bot credential
  (automatic within one heartbeat after verification; no manual restart).
- Wait for correct bot/owner pairing on that client bot.
- Deliver the localized pairing confirmation and activate when configuration,
  credentials, manifest, capability catalog, pairing and Telegram delivery
  evidence remain current.
- After `active`, optionally generate a Piloter pairing link and assign a
  subset of project-enabled tools (ADR-0057).

Content catalog synchronization, the reversible GitHub branch operation and
Vercel preview/SHA correlation bind to the first real request and remain
mandatory before approval/publication. They no longer require a synthetic
onboarding mutation.

## Validation record

Each check records name, version, result, evidence reference, error class, execution time and expiry/staleness rule. Required failures block activation; warnings require explicit admin acknowledgment and may not waive security invariants.

## Webbin onboarding changes

If Webbin lacks PR preview or safe Web3Forms behavior, Binflow prepares a separate onboarding change proposal/PR. It cannot combine workflow/configuration changes with generated article content. Approval of that onboarding PR is explicit and occurs before activation.

## Suspension and archive

Suspension blocks new requests and publication resumes while preserving read-only dashboard/audit access. Archive additionally disables bot/webhook operation and revokes project operational credentials where safe. Neither action deletes immutable audit history.
