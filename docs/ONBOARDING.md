# Client onboarding

## Model

Onboarding is administrator-managed and resumable. The first MVP relationship is:

```text
one tenant → one project → one client bot → one client user
```

The data model is multi-tenant-ready, but the enrollment cannot activate multiple projects/users until that later phase is documented and implemented.

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

- `astro_repo` is the only first-MVP option.
- Production domain and optional preview domain expectations.

### 3. Content and locale contract

- Content/default/required/slug locales constrained by the global manifest.
- Translation policy.
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
completed by the following catalog module and cannot be supplied by a model.

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

- Create the client user.
- Generate one-time 24-hour deep link.
- Wait for correct bot/user pairing.
- Activate only when all required validation checks remain current.

## Validation record

Each check records name, version, result, evidence reference, error class, execution time and expiry/staleness rule. Required failures block activation; warnings require explicit admin acknowledgment and may not waive security invariants.

## Webbin onboarding changes

If Webbin lacks PR preview or safe Web3Forms behavior, Binflow prepares a separate onboarding change proposal/PR. It cannot combine workflow/configuration changes with generated article content. Approval of that onboarding PR is explicit and occurs before activation.

## Suspension and archive

Suspension blocks new requests and publication resumes while preserving read-only dashboard/audit access. Archive additionally disables bot/webhook operation and revokes project operational credentials where safe. Neither action deletes immutable audit history.
