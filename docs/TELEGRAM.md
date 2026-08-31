# Telegram experience

The global admin bot and every tenant client bot have separate credentials,
state namespaces and ingress paths. The admin destination is established only
through the hash-only one-time owner pairing flow in ADR-0023. Client tool use
and admin-approval transitions enqueue durable notifications; notification
delivery never authorizes or advances a request.

## Topology

### Admin bot

One platform bot serves the platform owner and receives operational
notifications. The owner may **approve or reject** requests in
`AWAITING_ADMIN_APPROVAL` from this bot using inline buttons (ADR-0050), in
addition to the TOTP-verified dashboard. Pairing still requires a fresh dashboard
session; credential and enrollment mutations remain dashboard-only.

### Client bot

Each first-MVP enrollment owns a dedicated bot. The bot resolves one tenant/project and accepts one paired client user. The architecture permits additional bot integrations later without using message content to resolve tenant identity.

Both bots use a shared `MessagingGateway` domain interface and independent Chat SDK instances/state namespaces.

Local polling and production webhook handlers normalize updates before invoking
the same transport-neutral application service. Only that service may consume
pairing/action tokens or mutate requests.

Chat SDK routes Telegram bot commands through its slash-command dispatcher,
ordinary direct messages through its direct-message dispatcher, and inline
keyboard clicks through the action dispatcher. Binflow registers all three
paths and normalizes them into the same ingress contract before authorization.
In particular, `/start <token>` must reach the pairing service, persist the
target atomically and receive one deterministic success or denial reply; the
adapter's typing indicator is never treated as successful handling. A button
click is authorized as `/action <token>` using the clicking user’s numeric ID
from `callback_query.from`, never the original message author.

The Telegram numeric bot ID is globally unique among active credentials. The
same bot cannot be activated as both admin and client or reused by another
tenant; this identity is stored as a normalized external resource ID, not only
inside JSON evidence.

## Local and production transport

- Local: long polling; startup verifies that no incompatible webhook is active and explicitly disables Chat SDK webhook deletion.
- The worker discovers active `telegram-admin` and `telegram-client`
  credentials at process start **and** on each heartbeat reconcile. A client
  bot credential activated during enrollment starts polling without requiring
  a worker restart; otherwise `/start <token>` never reaches the pairing
  service and the enrollment stays `pairing_pending` after the operator
  believes pairing succeeded.
- Production cutover: HTTPS webhook with a unique secret token and restricted
  allowed updates. The production profile remains disabled until that later VPS
  ingress is implemented and validated.
- A bot may use polling or webhook mode, never both simultaneously.
- Credential verification is read-only: `getMe` confirms the expected bot identity and `getWebhookInfo` detects transport conflict. It never deletes/configures a webhook or sends a test message. Test delivery happens during onboarding after an authorized chat ID exists.

## Pairing

1. Admin creates the client user during enrollment.
2. Dashboard creates `t.me/<client-bot>?start=<opaque-token>`.
3. Token is random, hashed, tenant/user/bot scoped, single-use and valid for 24 hours.
4. Bot receives `/start`, validates the token and binds Telegram numeric user ID.
5. Bot posts the localized completion response.
6. Successful response delivery records `telegram_test_send` evidence and
   idempotently activates the enrollment; failed delivery leaves it pending.
7. Reuse, wrong bot, wrong user binding or expiration is rejected and audited.

Enrollment creates one pending client user and membership before issuing a
pairing link. Consumption records the active client bot credential ID.
Replay of the same already-consumed Telegram update may repeat the visible
completion response to recover from a post-delivery database interruption, but
cannot create a second identity, membership or activation transition.

Unpaired users receive a localized access-denied message and cannot discover project data or tool names.

## Client commands

| Command        | Behavior                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `/start`       | Pair or show current connection status.                                                                      |
| `/tools`       | List only enabled project capabilities.                                                                      |
| `/create_blog` | Start the blog capability; arguments are optional.                                                           |
| `/status`      | Show active/recent request states for this user/project.                                                     |
| `/cancel`      | Cancel an eligible active request after confirmation.                                                        |
| `/help`        | Explain supported interaction in the conversation locale.                                                    |
| `/action`      | Fallback that consumes an opaque action token. Primary client controls are inline buttons, not this command. |

Telegram command names use lowercase letters and underscores. Display labels may use natural language.

The bot command menu is synchronized from the active project capability bindings
via Telegram `setMyCommands` when bindings are published. Internal nodes such as
translation never appear as commands. `/tools` lists only enabled bindings from
the effective catalog.

## Natural-language routing

A normal message is evaluated only against enabled capabilities. The planner returns a schema-constrained intent, confidence and missing inputs. Low confidence or multiple plausible actions produces a clarification; it never chooses a more privileged capability.

For the local MVP router:

- **Blog:** messages mentioning *blog*, *article*, *artículo*, *Beitrag*, *post*, etc. start the project's assigned create-blog capability (`create_blog_draft` on `astro_repo`, `create_blog_orbitype` on `astro_orbitype`).
- **Menu update (`astro_orbitype`):** messages mentioning *menú*, *carta*, *Speisekarte*, *update menu*, *upload menu*, etc. start `update_menu` when assigned.
- **Text edit (`astro_orbitype`):** messages mentioning *editar texto*, *cambiar texto*, *edit text*, *Text ändern*, etc. start `edit_text` when assigned.
- **Portfolio project:** messages mentioning *proyecto*, *portafolio*, *portfolio*, *case study*, etc., or briefs with at least two structural cues (`Stack:`, `Rol:`, `Estado:`, `confidencial`, …), start `create_project_astro` when assigned — with or without the `/create_project` prefix.
- **`/create_project <brief>`** always routes to the portfolio tool when it is enabled.
- Portfolio collection (ADR-0035/0037): new project requests enter `NEEDS_INPUT`
  until base facts (`name`, year-month `fecha`, `projectDescription`) plus any
  required customization `content_schema` fields validate. Follow-up messages
  continue the same request. When closed, the bot shows the plan summary and
  confirm/cancel buttons.
- Slash commands and direct messages both accept JPEG/PNG/WebP photos during
  collection. Photo-only messages close `type: image` fields only; they must not
  invent `[image]` text that closes open string facts.

## Empty/incomplete blog command

`/create_blog` without a topic responds with:

- What the tool creates.
- Minimum input: one topic.
- Optional context, objective, audience, category, sources, keywords, date and image.
- Current synchronized categories.
- Process: plan confirmation → generation → preview → revision/approval → publication.
- One localized example.

Incomplete input asks only for the missing indispensable value. Values proposed by the LLM are shown in the plan and require client confirmation.

Telegram and `/create_blog` map the client message without slicing it to fit
`topic` (ADR-0031):

- Length ≤ 500 → brief mode with `topic` only.
- Length 501…10 000 → full text stored as `context`; `topic` is a localized
  provisional placeholder until execution.
- Length > 10 000 → localized “shorten your message” reply; no request.

After plan confirmation, when `context` is present, the executor runs
`interpret_brief` (LLM proposes a ≤500 character topic) before `similarity`.
The client confirms the brief, not a truncated title.

## Attachments

- A supported document may become a source or draft input.
- **`update_menu`:** during `NEEDS_INPUT`, a Telegram **PDF** (max 10 MB) persists
  as `documentArtifactKey`; non-PDF or oversize files get a localized rejection
  without storing bytes for model use.
- During portfolio `NEEDS_INPUT`, a JPEG/PNG/WebP photo on a DM **or** slash
  command closes `type: image` content-schema fields (Webbin `heroScreenshot`)
  and becomes the featured AVIF cover. Empty captions must not poison open
  string facts.
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
- Preview ready, with exact Vercel preview deployment URLs.
- Waiting for client/admin approval.
- Publishing.
- Production verified, with URL buttons to the project's public production
  origin (enrollment `productionDomain` / manifest `deployment.productionOrigin`;
  Webbin defaults to `https://webbin.com.mx`) and article routes. The message must
  not use a `*.vercel.app` deployment hostname as the live site.
- Failed with an actionable next step.

Updates should edit an existing progress message when safe to reduce noise; durable decisions and final results are separate messages.

## Plan and preview actions

Plan (create tools — `create_blog` / `create_project`):

- `Create draft` / `Crear borrador` / `Entwurf erstellen`
- `Cancel`

Plan (delete blog — `delete_blog`):

- `Delete post` / `Borrar artículo` / `Beitrag löschen` — confirms the
  deletion plan and queues `open_deletion_pr` (not a create-draft CTA)
- URL confirm (title-only path): `Yes, this one` / `Sí, es este` / `Ja, dieser`

Plan (`update_menu` — after PDF + button selection):

- `Publicar menú` / `Menü veröffentlichen` / `Publish menu` — `confirm_plan`
  queues execute (no preview deploy)
- `Cancelar` / cancel action aborts the request

Selection (`update_menu` — `select_ctas` step):

- Toggle buttons per discovered menu CTA (`toggle_menu_cta`)
- `Confirmar selección` / `Confirm selection` / `Auswahl bestätigen`
- `Cancel`

Plan (delete project — `delete_project`):

- `Delete project` / `Borrar proyecto` / `Projekt löschen` — confirms the
  deletion plan and queues `open_deletion_pr`
- URL confirm (title-only path): same labels as delete blog
- `Cancel`

Natural language for delete project: delete verb + portfolio cue
(`proyecto`, `portafolio`, `portfolio`, `case study`, …). Dispatched **before**
create-project NL when both match.

Command: `/delete_project <title or URL>` (requires capability assignment).

Confirm button labels are capability-specific. Destructive tools must never
reuse create-flow CTAs (`Create draft`).

Delete admin pending (after deletion PR opened):

- Text-only notice that an admin is reviewing the request; client is notified when deletion completes.
- **No** preview URL buttons (PR links are admin-only).
- **No** Cancel button — cancel is only available before plan confirm / URL confirm.

Preview (create/update tools only):

- `Open Spanish preview`
- `Open English preview`
- `Request changes`
- `Approve`
- `Cancel`

Revision plan (after feedback):

- `Confirm change`
- `Adjust request`
- `Cancel revision`

After **Request changes**, the next free-text message is accepted as revision
feedback ( `/revise <text>` remains valid). The worker then sends the revision
plan summary with the three buttons above. Confirm applies the surgical or full
path; adjust returns to waiting for feedback; cancel restores the prior preview
approval gate.

Admin approval (requests in `AWAITING_ADMIN_APPROVAL` only — ADR-0050):

- Summary card: tenant/project, capability, topic/target, why admin approval is
  required, and what approve vs reject implies.
- Optional preview URL buttons when policy allows.
- `Approve` / localized approve label — queues the same path as dashboard approve.
- `Reject` / localized reject label — **`CANCELLED`** + client
  `request.cancelled` notice (same as dashboard reject).

Admin informational notices (`request.created`, `request.failed_final`,
`request.published`) remain text or card without decision buttons unless
documented otherwise.

Plan, preview, revision and cancel controls are Telegram inline buttons on
every step that needs a decision, including worker-originated preview-ready
notices. Buttons carry only opaque action identifiers (the hashed-at-rest
plaintext token as `callback_data`). Visible text never lists `/action <token>`.
Server records bind action to user, role, tenant, project, request version,
artifact, state and expiry. Preview messages include URL buttons for the exact
Spanish (`/es/articulos/...`) and English (`/articulos/...`) Vercel preview
deployments. Publication-complete messages include URL buttons for those routes
on the live production origin. Typed `/action <token>` remains valid so tests
and clients without button support can still decide.

## Notifications to admin

Required events:

- `request.created`: every client capability use.
- `approval.required`: any policy requiring admin authority. Delivers the
  ADR-0050 summary card with Approve/Reject buttons when the request is in
  `AWAITING_ADMIN_APPROVAL`.
- `request.failed_final`: failure requiring intervention. The admin message
  includes request ID, failed node, error message and the dashboard path
  `/requests/{id}`.
- `request.published`: production verified.

Notifications include tenant/project, client, capability, request ID, concise summary and dashboard link. They exclude secrets, full prompts and attachment bodies.

Cancellation produces no admin notification. The platform owner is the actor and
reads the result in the dashboard response (ADR-0027).

## Notifications to client

Client notices for a running request are posted inline by the worker while it
executes the request. Transitions initiated from the dashboard instead enqueue a
durable `client.notification_requested` outbox event, drained by the worker on
the same schedule as admin notifications.

Required events:

- `request.cancelled`: the platform owner cancelled or **rejected** the request
  (dashboard or admin Telegram). The notice is the neutral terminal copy already
  used for client-initiated `/cancel`; it does not attribute the actor, name the
  platform owner or expose dashboard paths.
- `request.failed_final`: the request reached a terminal failure. The notice
  includes the request ID and error summary so the client is not left without
  a reply after plan confirmation; it does not include dashboard paths.
- `admin.direct_message` / `admin.request_message`: bounded freeform plain text
  (max 2000 characters) queued from the dashboard Message modal (ADR-0043).
  Enrollment-scoped sends remain. Request-scoped sends after **`admin_rejected`**
  are **deprecated** for new rejects (ADR-0050: reject → `CANCELLED` with
  automatic `request.cancelled` instead).

The message is rendered when the event is enqueued. For workflow notices such as
cancellation, the `conversationLocale` stored for that conversation is required;
a request whose locale cannot be resolved produces no cancellation event instead
of an English fallback. Freeform admin messages may use a neutral English prefix
when locale is missing; the freeform body is never auto-translated. The
destination chat is always resolved at delivery time from the paired channel
identity, never read from the event payload. Enrollment-scoped events resolve
via the enrollment’s tenant/project active channel identity; request-scoped
events resolve via the request’s user.

Client-initiated `/cancel` keeps its synchronous in-thread reply and enqueues
nothing, so the client never receives the same copy twice.

## Localization

Bot system messages support English, Spanish and German. Each enrollment has one `conversationLocale`. Content locales are separate and may not match the conversation locale. Missing translations fail tests; they do not silently fall back to mixed-language UI in production.

## Concurrency

- One active conversational collection step per user/project unless the user explicitly selects a request.
- Every incoming message is assigned to a conversation and request version before async processing.
- Thread locks prevent simultaneous handler mutation; durable request state resolves lock loss or restarts.
- `/cancel` may preempt future graph work but does not pretend to cancel an already completed external action.
