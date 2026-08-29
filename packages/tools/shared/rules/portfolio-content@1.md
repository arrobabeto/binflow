# Portfolio case study contract

Spanish is the source locale. English must preserve claims while adapting idiom.
English `descriptor`, `resumen`, `impacto`, section headings and body copy must be
idiomatic English and must not copy Spanish strings.

Never include real client or project names in `descriptor`, `clienteTipo`, or body
sections unless the manifest and confidentiality policy allow it. The public `url`
field may reference the real product when supplied. Prefer closed facts and
`urlEvidence` over invention. Never emit placeholders such as "Not specified".

`fecha` is year-month (`YYYY-MM`); frontmatter persists as month-start
(`YYYY-MM-01`). Covers are client hero screenshots re-encoded to AVIF.

Section headings and enum values follow the active project manifest. Do not invent
metrics in impact or outcome sections.

Invariant flags:

- avoidInventedClaims: true
- englishIsIdiomaticAdaptation: true
- englishMustNotCopySpanishTitlesOrHeadings: true
- sourceLocale: es
- requiredLocales: es, en
