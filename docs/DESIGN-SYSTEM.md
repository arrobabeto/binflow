# Dashboard design system

Canonical visual language for the Binflow admin dashboard (`apps/dashboard`).
Product behavior remains owned by [DASHBOARD.md](DASHBOARD.md). This document
owns tokens, layout chrome, and reusable UI patterns so future screens match
the dark control-plane design without inventing a second look.

Source of truth for the current look: Figma file `KHJ330ZIhb26dHowXa24Q5`
(control-plane frames). Implementation uses Nuxt UI 4 with Binflow tokens on
top (ADR-0044).

## Principles

1. **Dark-only control plane.** No light/dark toggle in the MVP dashboard.
2. **Nuxt UI as the component kit.** Prefer `UButton`, `UCard`, `UBadge`,
   `UInput`, `UModal`, etc. Style through tokens and thin wrappers, not a
   parallel component library.
3. **Data over decoration.** Layouts show operational evidence; do not invent
   metrics, capabilities, or statuses that the API does not return.
4. **Sidebar navigation** on authenticated pages; auth routes use a centered
   card without the shell.
5. **Semantic color for state**, not for decoration. Status meaning must also
   appear in text or badges.

## Color tokens

CSS custom properties live in `apps/dashboard/app/assets/css/main.css`.

| Token role | Approx value | Usage |
|---|---|---|
| Canvas | `#0b0c10` | Page background |
| Sidebar | `#0b0c10` / `#13161f` | Shell rail |
| Surface | `#13161f` | Cards, inputs, modal |
| Surface elevated | `#1f2433` | Hover / active nav, inset panels |
| Border | `#2a3142` | Card and field borders |
| Text primary | `#f3f4f6` | Titles, body |
| Text muted | `#6b7280` | Labels, breadcrumbs, hints |
| Primary | `#3b82f6` | Primary buttons, focus, active accents |
| Accent / cyan | `#22d3ee` (approx) | Technical ids, “CONTROL PLANE”, bot handles |
| Success | emerald | `active`, completed, healthy |
| Warning | amber | pairing pending, attention CTAs |
| Error | `#ef4444` | Failures, revoke, sign-out accent |

Nuxt UI semantic aliases (`--ui-primary`, `--ui-success`, …) map to generated
palette tokens so solid action buttons keep readable contrast.

## Typography

- **UI:** Geist (sans).
- **Mono:** Geist Mono for request ids, capability ids, fingerprints, SHAs.
- Page title: large semibold white.
- Section labels: small uppercase tracking, often cyan or muted.
- Eyebrow / brand subtitle: uppercase cyan (“CONTROL PLANE”, “SECOND FACTOR”).

## Layout

### Shell (`AppShell`)

- Fixed left sidebar ≈ 240px.
- Brand: Binflow mark + “CONTROL PLANE”.
- Nav groups with uppercase section labels:
  - Main: Home, Clients, Requests
  - Tools: Catalog (`/tools`), Customizations
  - System: Integrations, Operations
- Active item: elevated surface + primary accent indicator.
- Footer: avatar initials, email, “OPERATOR ROLE”, Sign out.
- Main column: breadcrumbs + page actions, then content (`max-w` per page).

### Auth

Centered card on canvas; no sidebar. Login, two-factor, and Security share this
pattern.

### Spacing and radius

- Page padding ≈ 24–32px.
- Card radius ≈ 8–12px (`--ui-radius`).
- Consistent vertical gaps between sections (~24px).

## Components

| Pattern | Guidance |
|---|---|
| Primary button | Solid primary blue, white label |
| Secondary / ghost | Dark surface, light border |
| Destructive | Error soft / outline (Revoke, Cancel request) |
| Badge | Soft pill; map enrollment/request states to success/warning/error/neutral |
| Metric card | Label, large value, detail, optional Open link |
| Attention banner | Full-width surface with warning CTA text |
| Client / list row | Surface card, status badge, mono project key, primary/secondary actions |
| Modal | Dim overlay; title; Sending-to inset; textarea; Cancel + primary Queue |
| Tool graph panel | Light panel on dark page; node kind badges EFFECT/AGENT/COMPUTE/INTERRUPT |
| Forms | Dark inputs, primary focus ring, required asterisk |

## Frame → route map

| Figma frame | Route / component |
|---|---|
| home-dashboard | `/` |
| clients-list | `/clients` |
| add-client | `/clients/new` |
| client-detail | `/clients/:id` |
| requests-inbox | `/requests` |
| request-detail | `/requests/:id` |
| tools-catalog | `/tools` |
| tool-graph-detail | `/tools/:toolId` |
| customizations | `/customizations` |
| integrations | `/integrations` |
| operations | `/operations` |
| two-factor-auth | `/two-factor` |
| message-modal | `SendClientMessageModal` |
| _(no frame)_ | `/login`, `/security` — auth DS |

## Do not

- Invent Usage/Audit/catalog-editor surfaces.
- Show secrets, chat ids in Message Sending-to beyond redacted bot username.
- Reintroduce top-bar primary navigation.
- Add a light theme toggle without a superseding ADR.
- Paste Figma placeholder capabilities or fake request topics into production UI.
