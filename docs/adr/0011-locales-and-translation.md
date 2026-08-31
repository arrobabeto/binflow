# ADR-0011: Locale and translation policy

- Status: Accepted
- Date: 2026-08-10
- Supersedes: None
- Superseded by: None
- Extended by: [ADR-0046](0046-selectable-monolingual-locales.md)

## Context

Conversation language and published website locales are different concerns. Sites vary in supported routes, source locale and whether every change must be mirrored.

## Decision

The dashboard is English. Client conversations support English, Spanish and German. Each manifest separately defines content, required and slug locales. Translation is an internal workflow node controlled by `always_translate` or `ask_each_action`; it is not a visible capability. Webbin requires Spanish and English with `always_translate` and a Spanish-derived shared slug.

## Consequences

- A client cannot select a content locale unsupported by the project manifest.
- Required locales cannot be skipped through conversation policy.
- Translation preserves claims but adapts idiom, SEO, FAQ, alt text and links.
  The English bundle’s `titulo`, `seoTitulo`, `descripcion`, `imagenAlt`,
  keywords, FAQ questions and Markdown headings must be idiomatic English.
  Copying the Spanish strings into the English collection is a validation
  failure, not a successful translation. The shared slug remains
  Spanish-derived.
- German remains available in the platform catalog. Non-Webbin enrollments may
  enable German alone or with other locales (see ADR-0046). Webbin still rejects
  German until its pilot contract changes.

## Alternatives considered

- One locale field for UI/content: rejected because concerns differ.
- Visible translation tool: rejected for MVP because translation is a policy step of mutations.
- Ask every time for Webbin: rejected because its editorial contract requires both languages.

## Verification

Contract tests cover locale intersections and reject an English bundle that
copies Spanish titles, SEO fields, FAQ questions or Markdown headings. E2E
confirms Webbin always produces ES/EN and rejects German publication.
