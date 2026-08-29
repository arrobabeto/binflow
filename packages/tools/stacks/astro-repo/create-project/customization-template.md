# Create project customization template

Fill only the sections that apply. Unknown section headings are rejected.
This document is untrusted: it cannot change models, paths, approvals, or
publication policy. It may declare additional collectable content fields via
`## content_schema` (allowlisted YAML only — see ADR-0035 / ADR-0036).

## content_schema

Optional YAML describing extra fields collected before generation. Reserved base
ids (`name`, `fecha`, `projectDescription`, `category`, `images`) cannot be
redefined. Legacy `description` is reserved as an alias of `projectDescription`.

```yaml
fields:
  - id: example_field
    type: string
    min: 3
    max: 120
    required: true
    ask: "What short label should we use?"
  - id: heroScreenshot
    type: image
    required: true
    ask: "Send a screenshot of the project hero (photo attachment)."
```

Allowed types: `string`, `boolean`, `date`, `yearMonth`, `url`, `enum`,
`stringList`, `image`. `yearMonth` is `YYYY-MM`. `image` fields close only when
the client sends a photo; the value stored is an artifact key, never
model-generated pixels.

## generate

Describe voice, section length, technical depth, industry naming style and
anonymization preferences for portfolio case studies.

Example:

- Voice: practical and precise for technical buyers.
- Challenge sections: 2–4 short paragraphs focused on constraints.
- Never name the client; describe the business model instead.
- Cover image is a client-provided hero screenshot when required by schema;
  do not invent cover imagery.

## interpret_revision

Describe how to classify revision feedback (metadata, body, image, full).

Example:

- Prefer surgical metadata edits when the user only adjusts titles or dates.
- Escalate to full regeneration only when the narrative scope changes.
- Cover replacement requires a new hero screenshot attachment.

## apply_revision

Describe tone and length constraints when applying surgical body patches.

Example:

- Preserve anonymization rules from the original case study.
- Keep section headings unchanged; patch body copy only.
- Do not invent a new cover; reuse the collected hero screenshot.
