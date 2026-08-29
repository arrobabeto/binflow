# Webbin — delete_blog_draft customization

Upload this file in Dashboard → Customizations → Webbin → `delete_blog_draft`.
It declares how Webbin collects the delete target (title or URL). Paths, locales,
models and approvals stay in code and manifest (ADR-0030, ADR-0040).

## content_schema

```yaml
fields:
  - id: targetTitle
    type: string
    min: 2
    max: 500
    required: false
    ask: "¿Qué artículo quieres borrar? Puedes enviar el título exacto o la URL pública."
  - id: targetUrl
    type: url
    required: false
    ask: "¿Cuál es la URL pública del artículo que quieres borrar?"
```
