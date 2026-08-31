# Create blog (Astro + Orbitype) — capability specification

Capability id: `create_blog_orbitype@1`  
Stack: `astro-orbitype`  
Executor: `workflow.create_blog_orbitype@1`  
Command: `/create_blog`  
Graph: `stacks/astro-orbitype/create-blog@1`  
Mutation class: `create`

Canonical decision: [ADR-0047](../adr/0047-create-blog-orbitype-dual-write.md).  
Layer tags: `[CODE]`, `[MANIFEST-*]`, `[CUSTOMIZATION]`.

---

## 1. Three layers

| Layer | Owns |
|-------|------|
| `[CODE]` | Input schema, dual-write ports, similarity, locale resolution from manifest, executor, Vercel preview binding |
| `[MANIFEST-*]` | `contentLocales`, `translationPolicy`, `publicationTargets`, GitHub blog `editablePaths`, Orbitype collection paths, routes |
| `[CUSTOMIZATION]` | Voice and cover mood (`generate`, `prepare_image`) — never paths, models, or locales |

---

## 2. Content contract

- Bundle: same blog article contract as `create_blog_draft` (`generatedBlogBundle`), constrained to **manifest locales** (monolingual when `translationPolicy: none`).
- GitHub artifacts: markdown (+ cover) under manifest `editablePaths`.
- Orbitype artifacts: allowlisted CMS draft/version rows keyed by request version
  on Bistro-shaped `posts` (`title`/`lead`/`status`/`sections` locale JSON,
  `keywords` array, `img` text). Wrong-column SQL must fail closed without retry.
- Preview: Vercel git-integration of the GitHub draft head; client CTAs use
  `/posts/{orbitypeDraftId}/{titleSlug}` (site CMS routes), not file-collection
  prefixes. Astro `PUBLIC_*` env must be enabled for **Preview** deployments.
- Publish: merge GitHub PR **then** promote Orbitype draft.

---

## 3. Capability inputs `[CODE]`

Same discriminated union as `createBlogDraftInputSchema` (`brief` | `draft`), registered as `create_blog_orbitype.input@1`. Locales are **not** input fields.

---

## 4. Graph pipeline `[CODE]`

```text
catalog_sync → interpret_brief → similarity → category_decision → generate
  → prepare_image → render_artifacts
  → create_github_draft → create_orbitype_draft → wait_preview
  → awaiting_client_approval → (revision | admin if new category)
  → merge_github → publish_orbitype → verify_production → completed
```

| node.id | nodeKind | Meaning |
|---------|----------|---------|
| `create_github_draft` | `publication.create_github_draft@1` | Open/update GitHub draft PR |
| `create_orbitype_draft` | `publication.create_orbitype_draft@1` | Create CMS draft/version |
| `merge_github` | `publication.merge_github@1` | Merge approved PR |
| `publish_orbitype` | `publication.publish_orbitype@1` | Publish CMS version |

---

## 5. Client-facing messages

### Plan confirm

Show topic/title only. Buttons: Create draft / Crear borrador / Entwurf erstellen.

### Preview

One Open preview button **per manifest locale** (Bistro: German only). Approve / Request changes / Cancel.

### Admin outbox

Client key, natural action, PR URL when present, request id. No repo paths.

| Surface | action | es | en | de |
|---------|--------|----|----|-----|
| Plan confirm | confirm_plan | Crear borrador | Create draft | Entwurf erstellen |
| Plan confirm | cancel | Cancelar | Cancel | Abbrechen |
| Preview | approve_preview | Aprobar | Approve | Freigeben |
| Preview | request_revision | Pedir cambios | Request changes | Änderungen anfordern |

---

## 6. Typed validation errors `[CODE]`

| Code | When |
|------|------|
| `high_content_overlap` | Similarity ≥ threshold |
| `slug_collision` | Slug exists in GitHub or Orbitype catalog |
| `orbitype_draft_failed` | CMS draft rejected |
| `orbitype_publish_failed` | CMS publish failed after merge |
| `github_draft_evidence_mismatch` | PR files ≠ artifacts |
| `preview_binding_mismatch` | Preview not bound to head |
| `manifest_locale_invalid` | Manifest locales/policy inconsistent |

---

## 7. Pilot manifest `[MANIFEST-BISTRO]`

Profile `astro_orbitype`, typically `contentLocales: ['de']`, `translationPolicy: none`.  
`publicationTargets: ['github', 'orbitype']`.  
Customization: `docs/customizations/bistro-create-blog-orbitype.md`.

---

## 8. Stack rollout

1. Migration `INSERT` `create_blog_orbitype@1` then `pnpm db:migrate` before dashboard assignment.
2. No default binding on empty `astro_orbitype` catalogs — assign per pilot.
3. Rematerialize enrolled Orbitype manifests after path / `publicationTargets` changes.
4. Upload Bistro customization via dashboard Customizations.

---

## 9. Verification

See brief `verification.scenarios` and `docs/TESTING.md` Orbitype create-blog rows.
NL: German blog cues + `/create_blog`; ES/EN cues when conversation locale allows.
