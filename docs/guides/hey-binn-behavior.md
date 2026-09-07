# Hey Binn behavior (operator view)

Code-owned rules for the Telegram advisor (`hey_binn` / ADR-0062). Clients
never see this page; operators use **Binn AI** in the dashboard.

## What Binn does

- Helps invent and refine content ideas against project context.
- Deterministic code loads allowlisted inventory (GitHub blog/portfolio
  catalogs, optional Orbitype pages, Shopify surface areas) into the model
  prompt. The LLM never receives read or write tools.
- Suggests an **enabled** tool or `/open_ticket`.
- After explicit client approval, emits a **typed message** for the client to
  paste when **they** start the tool.

## What Binn never does

- Mutate GitHub, CMS, Vercel, or Shopify content.
- Invoke tools, open tickets, merge, publish, or deploy.
- Receive shell, SQL, secret, or filesystem tools.
- Create workflow `requests` for the chat itself (v1).
- Persist multi-session conversation memory (v1).

## Model

- Default chat model: `gpt-5.6-luna` (project OpenAI credential, ADR-0042
  `hey_binn` scope).

## Ingress

- `/hey-binn` and greetings that address Binn (`Hey Binn`, `Hola Binn`, …).
- Does not steal bare courtesy (`hola`) or unrelated tool natural language.
- End chat: `/bye-binn`, or `Adiós Binn` / `Bye Binn` / `Gracias Binn` (and
  locale equivalents). Idle thread TTL: **10 minutes**.

## Usage

- Turns write `binn_usage_events` (ledger extension of ADR-0056).
- Dashboard Binn AI and Analytics usage aggregations include those rows under
  capability `hey_binn`.
