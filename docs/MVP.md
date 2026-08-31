# First MVP definition

## Goal

Deliver a locally operable Binflow control plane that enrolls Webbin, serves one client through Telegram and safely publishes a complete bilingual blog through GitHub and Vercel.

## User-visible flow

1. The platform owner logs into the English dashboard with password and TOTP.
2. The owner registers and validates Webbin, its client bot, OpenAI key, GitHub App installation, Vercel project, locales, rules, budgets and `create_blog_draft` binding.
3. The dashboard produces a one-time client pairing link.
4. The client opens the bot, sees available tools and invokes `/create_blog` or describes the desired blog naturally.
5. If the command is empty, the bot explains required inputs, process order, current categories and examples.
6. A short topic is enough to start. A longer client message is kept intact as
   brief `context` with a provisional topic; after plan confirmation,
   `interpret_brief` proposes the durable topic. The system may also propose
   missing objective, audience and category.
7. The client confirms the interpreted category and plan before generation.
8. Binflow synchronizes the content catalog and rejects high overlap.
9. Binflow researches when needed, creates the Spanish source, adapts English, and prepares an AVIF cover.
10. Binflow creates an isolated branch and PR containing only the allowed artifacts.
11. CI and Vercel produce an exact preview associated with the PR head SHA.
12. The client reviews both routes and either requests a revision, cancels or approves.
13. A new category adds admin approval after preview; existing or corrected categories do not.
14. Binflow revalidates, merges automatically, verifies production and notifies both channels.
15. The request remains reconstructable in the dashboard and original attachments are deleted.

## MVP acceptance criteria

### Enrollment and identity

- Only an authenticated platform owner can create or activate an enrollment.
- TOTP is mandatory before the owner can manage secrets or approvals.
- Bot token, OpenAI, GitHub and Vercel checks pass before pairing.
- One-time pairing tokens are hashed, scoped, expire within 24 hours and cannot be reused.
- An unpaired Telegram identity cannot list tools or create requests.

### Tool discovery and planning

- `/tools` and the bot menu show only project-enabled capabilities.
- Natural language can resolve to `create_blog_draft` without seeing other tenants or disabled tools.
- `/create_blog` with no arguments returns instructions and current categories.
- Brief mode starts with only a topic.
- LLM-proposed fields are visible and confirmed before generation.
- Category handling distinguishes existing, likely typo and new.

### Content generation

- Catalog sync runs before planning and again before writing.
- High overlap blocks creation and names the candidate articles.
- Claims requiring current/sensitive data use recorded primary sources when available.
- The system does not invent customers, results, statistics or first-person experience.
- Webbin always produces Spanish and idiomatic English with one slug.
- Frontmatter, FAQ, metadata, internal links and read times pass the manifest contract.
- The cover is a real AVIF with allowed dimensions, useful alt text and acceptable similarity.

### Git, preview and approval

- Branch name follows `bot/webbin/create-blog/<request-id>-<slug>` and starts at current remote `main`.
- The PR contains only two Markdown files and one AVIF unless a separately approved onboarding PR is involved.
- Required checks pass and preview corresponds to the exact head SHA.
- Preview cannot submit Web3Forms to its real destination.
- Revision creates a new request version and invalidates earlier approvals.
- Existing category publication requires client approval only.
- New category publication requires client and admin approval.
- Bot and dashboard admin actions use the same idempotent approval service.
- Admin reject (either surface) cancels the request and notifies the client
  (ADR-0050).

### Production and audit

- Approval triggers revalidation before merge.
- A changed SHA, missing check, conflict or stale deployment returns to review instead of publishing.
- Production deployment contains the expected merge commit.
- Both final localized URLs return successfully and expose expected metadata.
- Admin receives request-created, approval-required, failed and published notifications.
- Audit shows requester, frozen versions, model calls, rationale, costs, artifacts, PR, deployment, approvals and result.
- Secrets and attachment bodies do not appear in logs or audit payloads.
- Original Telegram attachments are deleted after completion or cancellation.

## MVP completion evidence

- Unit, contract, integration, security and E2E suites pass.
- Restart tests demonstrate checkpoint and approval survival.
- Duplicate Telegram events and callbacks do not duplicate requests or merges.
- One real article supplied and approved by the owner is published to Webbin.
- Local Compose instructions reproduce the system from an empty environment.
- Production Compose, Caddy and operational runbooks are ready even though VPS provisioning is deferred.

## MVP is not production hardening

The MVP proves the complete product loop. Formal VPS deployment, restore drills, full alerting, failure exercises, container update automation and expanded operational controls belong to the next phase, without weakening the security controls required for local acceptance.
