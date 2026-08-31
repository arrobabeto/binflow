# ADR-0046: Selectable content locales including monolingual

- Status: Accepted
- Date: 2026-08-30
- Supersedes: None
- Superseded by: None
- Extends: [ADR-0011](0011-locales-and-translation.md)

## Context

ADR-0011 fixed the platform conversation/content locale set to English,
Spanish and German, but the first MVP enrollment UI and Webbin pilot overlay
hard-coded bilingual `es`+`en` with `always_translate`. Operators enrolling
non-Webbin projects (for example `astro_orbitype`) could not choose a
single-locale German site even though `de` is a supported locale.

## Decision

1. **Platform catalog.** Every enrollment may select content locales only from
   `{en, es, de}`. Those three remain the only supported content/conversation
   locales.
2. **Per-project subset.** An enrollment chooses one, two or three content
   locales. Monolingual projects are valid (`contentLocales` length 1).
   `requiredLocales`, `defaultContentLocale` and `slugLocale` must stay inside
   the chosen set.
3. **Translation policy `none`.** When exactly one content locale is enabled,
   `translationPolicy` must be `none` (no translation workflow). When two or
   more locales are enabled, policy is `always_translate` or `ask_each_action`.
4. **Webbin freeze.** The `astro_repo` / Webbin pilot overlay remains exact
   `es`+`en`, Spanish source/slug, `always_translate`. That overlay is not
   relaxed by this ADR.

## Consequences

- Dashboard enrollment locale fields are editable except for the Webbin pilot
  overlay.
- Contracts add `none` to `TranslationPolicy`.
- Manifest builders for non-Webbin profiles accept monolingual configurations.
- Content tools must skip translation when policy is `none` (enforced when those
  tools run; enrollment only freezes the policy on the manifest).

## Alternatives considered

- Soft-disable translation while keeping `always_translate` on monolingual
  manifests: rejected; the policy would lie about runtime behavior.
- Unlock Webbin to German-only: rejected; pilot contract unchanged.

## Verification

- Enrollment with `contentLocales: ['de']` and `translationPolicy: 'none'`
  validates for `astro_orbitype`.
- Webbin still rejects German-only and `none`.
- Dashboard does not overwrite saved locales with hard-coded `es, en` for
  non-Webbin profiles.
