# Webbin — create_project_astro customization

Upload this file in Dashboard → Customizations → Webbin → `create_project_astro`.
It declares Webbin collectable fields (`## content_schema`) plus editorial style.
Paths, models and approvals stay in code and manifest (ADR-0030, ADR-0034,
ADR-0035, ADR-0036, ADR-0037).

## content_schema

```yaml
fields:
  - id: url
    type: url
    required: true
    ask: "¿Cuál es la URL pública del sitio? (la leemos para entender el proyecto y se usa en el botón Visitar)"
  - id: heroScreenshot
    type: image
    required: true
    ask: "Envía una captura del hero del sitio (foto adjunta). Se usará como imagen destacada en AVIF."
  - id: projectHighlight
    type: string
    min: 20
    max: 2000
    required: false
    ask: "Opcional: ¿hay un highlight o ángulo que quieras enfatizar en el caso de estudio?"
  - id: stack
    type: stringList
    minItems: 1
    maxItems: 30
    required: true
    ask: "Lista las tecnologías reales del proyecto (comas). Ejemplos: Astro, Orbitype, Tailwind, Headless CMS, Vercel, WordPress, Oxygen. No envíes la URL del sitio."
  - id: clienteTipo
    type: string
    min: 3
    max: 120
    required: true
    ask: "¿Qué tipo de negocio o cliente es? (ej. Restaurant, language school, Home care organisation). No uses la URL ni nombres confidenciales."
  - id: industria
    type: string
    min: 3
    max: 120
    required: true
    ask: "¿En qué industria o sector opera? (ej. Hospitality, Healthcare, Edtech, Industrial). No uses la URL del sitio."
  - id: didDesign
    type: boolean
    required: true
    default: false
    ask: "¿Webbin también diseñó (UI/UX/brand)? Responde sí o no. El desarrollo se asume."
  - id: didMigration
    type: boolean
    required: true
    default: false
    ask: "¿Hubo migración (CMS, host, stack)? Responde sí o no."
  - id: roleExtras
    type: string
    min: 3
    max: 160
    required: false
    ask: "Opcional: ¿algún rol extra (tooling custom, SEO técnico, etc.)?"
  - id: impacto
    type: string
    min: 40
    max: 1000
    required: true
    ask: "¿Cuál fue el impacto verificable (GTmetrix, menos plugins, flujo operacional, etc.)? Sin métricas inventadas."
  - id: tipo
    type: enum
    values: ["Sitio web", "Landing page", "Aplicacion web", "Ecommerce"]
    required: true
    ask: "¿Qué tipo de entrega es? Sitio web, Landing page, Aplicacion web o Ecommerce."
  - id: estado
    type: enum
    values: ["Publicado", "En progreso", "Concepto"]
    required: true
    ask: "¿En qué estado está? Publicado, En progreso o Concepto."
  - id: confidencial
    type: boolean
    required: true
    default: true
    ask: "¿El caso debe ser confidencial (sin nombres propios de empresa/producto)? Responde sí o no. Es independiente del tipo de cliente."
  - id: destacada
    type: boolean
    required: false
    default: false
    ask: "¿Quieres destacarlo en el portafolio? Responde sí o no."
```

## generate

Voice: Webbin agency — practical, confident, technical but readable for founders and
marketing leads. Write like a senior product partner, not a generic AI summary.

Treat closed facts (`name`, year-month `fecha`, `projectDescription`, and
content_schema fields) plus `urlEvidence` as authoritative. Do not invent stack
items, URLs, KPIs, or client names. Never emit placeholders like "Not specified".

Ground Challenge / Solution / Outcome in:

1. `urlEvidence` (what the live site is about — services, claims, visible stack).
2. Base `projectDescription` and optional `projectHighlight`.
3. Closed metadata (`stack`, `clienteTipo`, `industria`, `impacto`, role flags).

Compose `rol` as: desarrollo + diseño when `didDesign` + migración when
`didMigration` + optional `roleExtras`. Always include base desarrollo /
Development even when both flags are false. Code force-merges this; keep
narrative consistent.

Generate titles and subtitles:

- `descriptor` — short portfolio title (ES/EN), similar to real Webbin cases
  (e.g. migration / headless / corporate industrial angles). Prefer refining
  meaning from URL evidence + description; do not ask the client for a separate
  descriptor string.
- `resumen` — one-sentence subtitle grounded in the same evidence.

Section lengths (Spanish source, English adaptation):

- **Reto / Challenge:** 150–280 words, 2–4 paragraphs. Problem, constraints, why
  off-the-shelf failed. Never name the client when `confidencial: true`.
- **Solución / Solution:** 200–400 words, 3–6 paragraphs. Architecture and role.
  Name real technologies from closed `stack` only.
- **Resultado / Outcome:** 150–280 words, 2–4 paragraphs. Capabilities delivered.
  Use verified `impacto` facts only; if a metric is missing, say so explicitly.

Map closed facts into the bundle:

- `fecha` is year-month; frontmatter stores month-start (`YYYY-MM-01`).
- `confidencial`, `tipo`, `estado`, `stack`, `url`, `clienteTipo`, `industria`,
  `impacto`, `destacada` → frontmatter as given (code force-merges these).
- `stack` must be the closed technology list only — never the project URL.
- `clienteTipo` / `industria` are business type and sector — never a URL.
- Featured cover: set `imagen` to the hero AVIF public path
  (`/images/projects/{slug}.avif`). Code overwrites this when a screenshot was
  collected; do not emit `.jpg`/`.png` cover paths.
  Do not invent or describe a generated cover image.

Anonymization:

- Default `confidencial: true` — no company or product names in narrative fields.
  Identifying fields allowed: `url` and the hero screenshot of that public UI.
- `clienteTipo` is the **business type** (Restaurant, language school, Home care
  organisation), never a synonym for confidentiality.
- When `confidencial: false`, you may name the product in narrative sections.

Enums stay in Spanish in both locales (`Sitio web`, `Publicado`, etc.) — do not
translate enum labels.

Prohibited:

- Invented KPIs, revenue, conversion rates or timelines not in closed facts /
  urlEvidence.
- Client names in `descriptor`, `clienteTipo` or body when `confidencial: true`.
- Generic filler ("cutting-edge", "world-class", "seamless experience").
- Asking the model to generate a featured image.
- Placeholder strings ("Not specified", "TBD", "Confidential client" as clienteTipo).

Good descriptor (ES): "Sitio headless para reserva de clases de idiomas"
Bad descriptor: "Proyecto Zofingen Academy" (real client name).

Good impacto: "Permitió contratar clases sin coordinación manual por solicitud."
Bad impacto: "+40% conversiones" (unverified metric).

## interpret_revision

Classify feedback narrowly:

- Title/descriptor/resumen tweaks → surgical metadata or `set_title`.
- Section copy edits → `body_patch` on affected locale(s).
- Cover only → require a new hero screenshot attachment (`image_only` plan);
  do not regenerate pixels with a model.
- Scope change (new integrations, different industry story) → `full_regenerate`.

Prefer surgical plans when the user asks for wording changes. Escalate to full
regeneration only when the brief scope materially changes.

## apply_revision

When patching body copy:

- Preserve anonymization rules and section headings (manifest H2 titles are fixed).
- Keep section length bands from `## generate`.
- Do not introduce new metrics or client names unless `confidencial: false` and the
  user explicitly requested naming.
- English patches must remain idiomatic adaptations, not literal translations of
  Spanish sentences.
- Reuse the existing hero screenshot unless a new attachment was collected.
