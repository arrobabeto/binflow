# ADR-0054: Client Telegram tool catalog (`/tools` + `/info`)

- Status: Proposed
- Date: 2026-08-31
- Supersedes: None
- Superseded by: None

## Context

Clients need a place to learn what each enabled tool does and how to start it
without starting a request. Expanding `/tools` into a long multi-line catalog
was tried and rejected as too noisy. Inline “Más info” buttons would require
action tokens without a request (new infrastructure).

## Decision

1. **`/tools`** keeps the compact list of enabled bindings as
   `command — displayName` (registry labels), plus a short localized footer that
   points to `/info` (example: `/info edit_text`).
2. **`/info`** without args lists enabled tools and asks for a name.
   **`/info <tool>`** accepts capability id, slash command (with or without
   `/`), or normalized localized title; if the tool is not enabled for the
   project, reply with a localized miss message (do not leak other projects’
   tools).
3. Detail copy is **code-owned** and localized (`de` / `en` / `es`) in
   workflows — not customization markdown. `/tools` does not use that rich copy.
4. `/info` **does not** create or resume requests. Starting a tool remains
   slash command, NL routing, or empty-command guidance.
5. `/help` (and pairing copy) points clients to `/tools` and `/info`.
6. When Telegram `setMyCommands` is synced, capability command descriptions may
   use the same localized one-line summaries (≤256 chars), plus the meta
   commands `/tools`, `/info`, `/help`, `/status`, `/cancel`.

## Consequences

- Browse stays two-step: short list → optional detail.
- Every registry capability must ship `/info` catalog copy or tests fail.
- Operators still assign tools via Dashboard; the menu never invents bindings.

## Alternatives considered

- **Rich `/tools` with summary + start hint per line:** rejected after trial —
  too long for non-technical clients; detail belongs in `/info`.
- **Inline “Más info” / “Usar” buttons:** deferred — needs request-less action
  tokens.

## Verification

- Unit tests: every `capabilityRegistry` id has catalog copy; resolver covers
  id/command/title; `/tools` stays compact with `/info` footer; `/info` filters
  by enabled bindings.
- Docs: `docs/TELEGRAM.md`, `docs/CHANGELOG.md`, this ADR.
