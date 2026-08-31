# Client enrollment runbook

Operator step-by-step for activating a client enrollment. Product rules and
lifecycle live in [ONBOARDING.md](ONBOARDING.md). This runbook is the
operational path used from the dashboard (and CLI when needed).

Use:

- **Section A** when the project profile is already selectable and shipped
  (`astro_repo`, `astro_orbitype`, …).
- **Section B** for the **first** client after a stack/profile was just
  implemented (docs from [`new-stack`](../.cursor/skills/new-stack/SKILL.md)
  plus a completed implementation session).

Stack/profile naming: stack id is hyphenated (`astro-orbitype`); project
profile is underscored (`astro_orbitype`). See [GLOSSARY.md](GLOSSARY.md).

---

## A. Enroll a client on an active stack

### A0. Preflight

1. Confirm **one** worker is polling Telegram locally. Do not run Compose
   `worker` and host `@binflow/worker` (`pnpm dev` / `pnpm run dev:live`) at
   the same time — a second `getUpdates` client yields
   `Conflict: terminated by other getUpdates request` and the bot goes mute.
   See [OPERATIONS.md](OPERATIONS.md).
2. Confirm platform credentials are healthy: OpenAI, Telegram **admin** bot.
3. Decide live execution: keep `BINFLOW_LIVE_EXECUTION_ENABLED=false` unless
   you intentionally want post-confirm OpenAI/GitHub/Vercel mutations
   (`pnpm run dev:live`). Enrollment/pairing itself does not require live
   execution.
4. Know the target **project profile** and whether an empty capability catalog
   is allowed at activation (documented per profile; `astro_orbitype` yes,
   `astro_repo` no).

### A1. Create the enrollment

1. Dashboard → **Clients** → **New**.
2. Set stable slugs:
   - **Client key** = `tenantKey` (e.g. `bistro`).
   - **Project key** = `projectKey` (often same as tenant for 1:1 MVP).
3. Select **project profile** (`astro_repo` or `astro_orbitype`, …).
4. Configure locales (platform set is `en` / `es` / `de`). Webbin /
   `astro_repo` overlay stays bilingual `es`+`en` + `always_translate` when
   that freeze applies; other profiles may be monolingual with
   `translationPolicy: none` (ADR-0046).
5. Fill domains (including **production** public HTTPS origin used in
   publication-complete Telegram links — ADR-0048), editorial fields, budgets
   as required by the form.
6. Save the draft.

### A2. Integrations and credentials

Register and **Verify** each required binding for the profile. Typical set:

| Kind | Notes |
|------|--------|
| `telegram-client` | Dedicated bot for **this** tenant. Expected username must match BotFather. Not the admin bot. |
| `github-app` | App private key + webhook secret. Non-Webbin: explicit `owner` / `repo` / `branch`. Installation must see only the intended repos. |
| `vercel` | Full-account token for the **correct Vercel team**. Project ID, team/account ID, linked repo and production branch must match the binding. Team mismatch → `policy_denied`. |
| `openai` | Platform or project-scoped as documented. |
| Profile-specific (e.g. `orbitype-api`) | Enter in enrollment/integrations UI; encrypted at rest; read-only verify only. |

Wait until verification status is success before Validate.

### A3. Validate

1. On the enrollment detail, run **Validate**.
2. Expect `ready_for_pairing` when all required checks for the profile succeed.
3. If the page was open across validate/pairing, save may hit `409` stale
   `If-Match`. The UI refreshes and retries once; if it still fails, reload
   the page.

### A4. Pair the client Telegram bot

1. Generate the **pairing link** (shown once).
2. Open it on the **client** bot (`t.me/<CT_…_bot>?start=…`), not the admin bot.
3. If the client bot credential was just verified, the worker discovers it on
   the next heartbeat reconcile (no manual restart required for a new bot
   alone). See [TELEGRAM.md](TELEGRAM.md).
4. Success: localized pairing confirmation, then enrollment becomes `active`
   after delivery evidence (`telegram_test_send`).
5. Bare `/start` without the token does not pair. After pairing, `/help` /
   `/start` should reply; `/tools` lists enabled tools or access-denied when
   the catalog is empty.

### A5. Tools

- Assign only tools whose `allowedProfiles` include this project profile.
- If the profile allows an empty catalog at activation, leave tools empty
  until the first capability ships via create-tool.
- Do not assign `astro_repo` tools to an `astro_orbitype` project (and vice
  versa).

### A6. Frequent failures

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Bot never replies | Multiple workers polling the same bot | Stop extras; one poller only |
| Pairing link “works” but enrollment stays `pairing_pending` | Worker never started that client bot | Confirm credential `active` + worker running; wait one heartbeat |
| `409 Conflict` on PATCH | Stale enrollment version, or enrollment in a non-editable state (`suspended` / `archived`) | Reload; for `active` clients use **Save profile** (domain, locales, budgets). Pre-activation edits still re-enter `configuring` |
| Vercel verify `policy_denied` | Wrong team/project/repo/branch vs token | Align IDs; use full-account token for that team |
| Preview deploy `PUBLIC_SITE_URL is missing` / `BUILD_UTILS_SPAWN_1` | Required Astro `PUBLIC_*` env only on Production | In Vercel project → Settings → Environment Variables, enable those keys for **Preview** (and Development if used). Bistro needed `PUBLIC_SITE_URL` on Preview. |
| GitHub verify 403 / wrong repo | Installation or owner/repo/branch mismatch | Fix binding; re-verify |
| `/tools` access denied after active | Empty catalog (expected for some profiles) | Assign tools or wait for first stack capability |

---

## B. First client after a newly added stack

Complete **Section A**, plus these gates. The stack should already have passed
[`new-stack`](../.cursor/skills/new-stack/SKILL.md) preparation **and** a
separate implementation session (contracts, dashboard, verifiers, etc.).

### B1. Stack readiness gate

1. Spec under `docs/specs/` and accepted ADR for the profile exist.
2. Profile appears in **New client** profile select (`selectableEnrollmentProfile`).
3. Activation checks for the profile are listed in ONBOARDING / the spec
   (including any new credential kind).
4. Empty-catalog rule is explicit: allowed or required minimum tools.
5. Freeze of existing stacks (`astro_repo` tools, ADR-0042 shared ports) is
   unchanged unless a superseding ADR says otherwise.

### B2. Extra smoke

1. Create enrollment with the **new** profile only (do not reuse Webbin
   overlays by accident).
2. Verify every profile-required credential, including the new provider if any.
3. Validate → pairing on the new client bot → confirm `active` in the
   dashboard (pairing-pending auto-refresh or manual reload).
4. Confirm the client bot replies to `/help` after pairing.
5. Confirm incompatible tools do not appear as assignable for this profile.
6. Restart the worker only if implementation changed worker code; a newly
   verified bot alone does not require restart.

### B3. After first successful enrollment

1. Record any ops gaps in CHANGELOG / OPERATIONS if the runbook was wrong.
2. First content capability → [`create-tool`](../.cursor/skills/create-tool/SKILL.md)
   (stack dir under `packages/tools/stacks/<stack>/` when that tool ships).

---

## Related documents

- [ONBOARDING.md](ONBOARDING.md) — lifecycle and validation model
- [TELEGRAM.md](TELEGRAM.md) — topology, pairing, local polling reconcile
- [INTEGRATIONS.md](INTEGRATIONS.md) — credential verification
- [OPERATIONS.md](OPERATIONS.md) — single polling worker, live execution
- [DASHBOARD.md](DASHBOARD.md) — enrollment UI behavior
- [ADR-0007](adr/0007-telegram-topology.md) — admin vs client bots
- [ADR-0045](adr/0045-astro-orbitype-enrollment.md) — example new-stack enrollment
