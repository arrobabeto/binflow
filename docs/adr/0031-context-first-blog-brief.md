# ADR-0031: Context-first blog brief with provisional topic

- Status: Accepted
- Date: 2026-08-21
- Supersedes: None
- Superseded by: None

## Context

Brief-mode `create_blog_draft` separates a short `topic` (≤500) from optional
`context` (≤10 000). After the 500-character Zod rejection was fixed, Telegram
ingress truncated the client message to fill `topic` and stored the remainder as
`context`. That mutilated the client brief and produced unreadable splits.

Clients often send one natural-language brief that is longer than a title. The
product already allows a topic-only start for short messages; long briefs need
the full text preserved.

## Decision

1. Deterministic Telegram/create ingress never slices the client message to
   satisfy the topic length. Mapping is:
   - empty → guidance;
   - length ≤ 500 → `topic` only;
   - length 501…10 000 → full text in `context`, localized provisional
     `topic` (placeholder);
   - length > 10 000 → localized rejection, no request.
2. The provisional topic is a display/queue label only until execution. Plan
   confirmation still confirms the brief (including `context`), not a truncated
   title.
3. When `mode === 'brief'` and `context` is present, execution runs
   `interpret_brief` after `catalog_sync` and before `similarity`. The
   generation port proposes a topic ≤500 characters from `context`. Deterministic
   code validates and persists `requests.topic` and `interpretedInput.topic`.
4. Similarity and generation use the refined topic and the full interpreted
   input. The model proposes; it does not authorize publication.
5. Live execution is fail-closed on proposeTopic errors (retryable vs final via
   existing DomainError mapping). Tests may use a deterministic fake.

## Consequences

- Dashboard and `/status` may briefly show the placeholder until
  `interpret_brief` completes.
- Tool graph and `CREATE_BLOG_EXECUTION_STAGES` include `interpret_brief`.
- Short titles continue to work without an LLM call at interpret time.

## Alternatives considered

- Word-boundary truncate into topic + remainder context: rejected; destroys the
  client brief.
- Synchronous LLM at Telegram create: rejected; couples ingress latency and
  OpenAI to `WorkflowService`.
- Heuristic-only topic forever: rejected; option 3 requires LLM refinement
  before similarity.

## Verification

Mapping unit tests cover short, long, and oversize messages. Executor/runtime
tests prove long context is stored intact, `interpret_brief` runs before
similarity, and the refined topic is persisted. Tools catalog tests assert
`interpret_brief` is a declared stage.
