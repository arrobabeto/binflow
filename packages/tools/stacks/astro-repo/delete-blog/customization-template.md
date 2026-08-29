# Delete blog customization template

Optional client-specific asks for identifying the article to delete.
Structural scope (locales, paths, approvals) is manifest- and code-owned.

## content_schema

```yaml
fields:
  - id: targetTitle
    type: string
    min: 2
    max: 500
    required: false
    ask: "Which blog post should be deleted? Send the exact title or public URL."
  - id: targetUrl
    type: url
    required: false
    ask: "What is the public URL of the blog post to delete?"
```
