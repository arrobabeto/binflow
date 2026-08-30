# ADR-0044: Dark control-plane dashboard design system

- Status: Accepted
- Date: 2026-08-29
- Supersedes: None
- Superseded by: None

## Context

The first dashboard shell used a light mint canvas and a top navigation bar
(Nuxt UI defaults plus local CSS). The product needed a denser operations
cockpit that matches the Figma control-plane redesign: persistent sidebar,
dark surfaces, and a documented token set so future pages do not drift.

This is a presentation decision. Trust boundaries, auth, approvals, and API
contracts are unchanged (ADR-0009, ADR-0016, ADR-0024, ADR-0043).

## Decision

1. The admin dashboard is **dark-only**. `colorMode` remains disabled; there is
   no operator light/dark toggle in the MVP.
2. Visual tokens, sidebar information architecture, and reusable patterns are
   canonical in `docs/DESIGN-SYSTEM.md` and implemented via CSS variables plus
   Nuxt UI theme overrides in `apps/dashboard`.
3. Authenticated pages use a left **sidebar shell** (Main / Tools / System
   links, not dropdown menus). Login, two-factor, and Security stay on the auth
   layout without the shell.
4. Implementation adapts Figma layout and color; it does not adopt mock data,
   invented capabilities, or placeholder copy from design frames.

## Consequences

- Operators get a consistent dark control plane across Home, Clients, Requests,
  Tools, Integrations, Operations, and related detail views.
- Future UI work must extend the Design System document and tokens rather than
  introducing a second palette or chrome pattern.
- Theme unit tests assert the dark token mapping so solid actions keep contrast.

## Alternatives considered

- Keep light mint + top nav: rejected; diverges from the accepted Figma direction.
- Full custom component library: rejected; Nuxt UI already covers forms/modals.
- Optional light mode: deferred; would need a superseding ADR and dual QA.
