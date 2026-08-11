# Telegram experience

## Topology

### Admin bot

One platform bot serves authenticated platform owners. It receives operational notifications and exposes idempotent approval actions.

### Client bot

Each first-MVP enrollment owns a dedicated bot. The bot resolves one tenant/project and accepts one paired client user. The architecture permits additional bot integrations later without using message content to resolve tenant identity.

Both bots use a shared `MessagingGateway` domain interface and independent Chat SDK instances/state namespaces.

The Telegram numeric bot ID is globally unique among active credentials. The
same bot cannot be activated as both admin and client or reused by another
tenant; this identity is stored as a normalized external resource ID, not only
inside JSON evidence.

## Local and production transport

- Local: long polling; startup verifies that no incompatible webhook is active and explicitly disables Chat SDK webhook deletion.
- Production: HTTPS webhook with a unique secret token and restricted allowed updates.
- A bot may use polling or webhook mode, never both simultaneously.
- Credential verification is read-only: `getMe` confirms the expected bot identity and `getWebhookInfo` detects transport conflict. It never deletes/configures a webhook or sends a test message. Test delivery happens during onboarding after an authorized chat ID exists.

## Pairing

1. Admin creates the client user during enrollment.
2. Dashboard creates `t.me/<client-bot>?start=<opaque-token>`.
3. Token is random, hashed, tenant/user/bot scoped, single-use and valid for 24 hours.
4. Bot receives `/start`, validates the token and binds Telegram numeric user ID.
5. Reuse, wrong bot, wrong user binding or expiration is rejected and audited.

Unpaired users receive a localized access-denied message and cannot discover project data or tool names.

## Client commands

| Command        | Behavior                                                  |
| -------------- | --------------------------------------------------------- |
| `/start`       | Pair or show current connection status.                   |
| `/tools`       | List only enabled project capabilities.                   |
| `/create_blog` | Start the blog capability; arguments are optional.        |
| `/status`      | Show active/recent request states for this user/project.  |
| `/cancel`      | Cancel an eligible active request after confirmation.     |
| `/help`        | Explain supported interaction in the conversation locale. |

Telegram command names use lowercase letters and underscores. Display labels may use natural language.

The bot command menu is synchronized from the active project capability bindings. Internal nodes such as translation never appear as commands.

## Natural-language routing

A normal message is evaluated only against enabled capabilities. The planner returns a schema-constrained intent, confidence and missing inputs. Low confidence or multiple plausible actions produces a clarification; it never chooses a more privileged capability.

## Empty/incomplete blog command

`/create_blog` without a topic responds with:

- What the tool creates.
- Minimum input: one topic.
- Optional context, objective, audience, category, sources, keywords, date and image.
- Current synchronized categories.
- Process: plan confirmation → generation → preview → revision/approval → publication.
- One localized example.

Incomplete input asks only for the missing indispensable value. Values proposed by the LLM are shown in the plan and require client confirmation.

## Attachments

- A supported document may become a source or draft input.
- An image may become the proposed cover after MIME/dimension/rights checks.
- Multiple messages can attach to the current request only while it is collecting input or revision instructions.
- The user must confirm they have rights to an uploaded image before it can be published.
- Unsupported or unsafe files are rejected without passing bytes to a model.

## Progress messages

The bot communicates user-relevant state, never internal chain-of-thought:

- Analyzing request.
- Waiting for information.
- Plan ready.
- Synchronizing existing content.
- Generating draft.
- Translating content.
- Preparing image.
- Validating change.
- Building preview.
- Preview ready.
- Waiting for client/admin approval.
- Publishing.
- Production verified.
- Failed with an actionable next step.

Updates should edit an existing progress message when safe to reduce noise; durable decisions and final results are separate messages.

## Plan and preview actions

Plan:

- `Create draft`
- `Modify plan`
- `Cancel`

Preview:

- `Open Spanish preview`
- `Open English preview`
- `Request changes`
- `Approve`
- `Cancel`

Admin approval:

- `Open preview`
- `Approve new category and publication`
- `Reject`

Buttons carry only opaque action identifiers. Server records bind action to user, role, tenant, project, request version, artifact, state and expiry.

## Notifications to admin

Required events:

- `request.created`: every client capability use.
- `approval.required`: any policy requiring admin authority.
- `request.failed_final`: failure requiring intervention.
- `request.published`: production verified.

Notifications include tenant/project, client, capability, request ID, concise summary and dashboard link. They exclude secrets, full prompts and attachment bodies.

## Localization

Bot system messages support English, Spanish and German. Each enrollment has one `conversationLocale`. Content locales are separate and may not match the conversation locale. Missing translations fail tests; they do not silently fall back to mixed-language UI in production.

## Concurrency

- One active conversational collection step per user/project unless the user explicitly selects a request.
- Every incoming message is assigned to a conversation and request version before async processing.
- Thread locks prevent simultaneous handler mutation; durable request state resolves lock loss or restarts.
- `/cancel` may preempt future graph work but does not pretend to cancel an already completed external action.
