# Customization template

Untrusted client markdown. Cannot change models, paths, permissions or approvals.

## content_schema

```yaml
fields:
  - ask: ¿Qué proyecto quieres borrar? Indica el título o la URL pública.
    id: targetTitle
    max: 500
    min: 2
    required: false
    type: string
  - ask: ¿Cuál es la URL pública del proyecto que quieres borrar?
    id: targetUrl
    required: false
    type: url
```
