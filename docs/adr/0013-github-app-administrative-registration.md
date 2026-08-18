# ADR-0013: GitHub App administrative registration with runtime downscoping

- Status: Accepted
- Date: 2026-08-10
- Supersedes: ADR-0012 only for the GitHub App registration permission set
- Superseded by: ADR-0014 only for the administrative installation-audit token exception

## Context

ADR-0012 selected a least-privilege GitHub App for normal publication. The platform owner has explicitly chosen to register the first Binflow GitHub App with the administrative and workflow permissions needed to support separately authorized Webbin onboarding operations from the same installation. Registering those permissions expands the installation's potential authority even though ordinary blog requests do not need it.

## Decision

Register the first GitHub App with this repository permission ceiling:

- Administration: read/write.
- Metadata: read.
- Contents: read/write.
- Pull requests: read/write.
- Checks: read.
- Commit statuses: read.
- Deployments: read.
- Workflows: read/write.

Do not grant Actions, Actions secrets, Dependabot secrets or access to any repository other than the selected pilot. Install the app only on `arrobabeto/webbin`.

The registration permission ceiling is not the runtime permission set. Every installation access token must be limited to `arrobabeto/webbin` and downscoped to the permissions needed by the current deterministic operation. Normal `create_blog_draft` execution omits Administration and Workflows. An operation may request Administration or Workflows only when all of these conditions hold:

1. it is a separately modeled onboarding or repository-configuration action;
2. an administrator has explicitly authorized that exact action;
3. deterministic policy has validated repository, paths and expected state;
4. the operation is isolated from generated content changes and fully audited; and
5. the token expires normally and is never exposed to the model, queue payload or logs.

The LLM cannot select token permissions or invoke an administrative/workflow operation directly.

## Consequences

- A compromised installation has a larger theoretical permission ceiling than strict least privilege, so repository-only installation and per-operation token downscoping are mandatory compensating controls.
- Webbin onboarding/configuration changes remain separate from content PRs and require explicit admin authorization.
- Normal publication retains the branch, PR, preview, exact-approval and merge controls from ADR-0012.
- Adding another repository or granting any secret-management permission requires a new security review and ADR.

## Alternatives considered

- Register a publication-only app and a separate onboarding app: stronger privilege separation, but rejected for the first pilot by explicit platform-owner decision.
- Use one full-permission token for all operations: rejected because registration authority must not become ambient runtime authority.
- Use a personal access token: rejected because installation scope, expiration and auditable app identity are required.

## Verification

- Installation discovery returns only `arrobabeto/webbin`.
- Token-generation tests assert repository and permission downscoping for every operation class.
- A normal blog token cannot call Administration or Workflows endpoints.
- An onboarding operation fails without exact admin authorization and a matching deterministic policy decision.
- App configuration audits fail if Actions, Actions secrets or Dependabot secrets are present.
