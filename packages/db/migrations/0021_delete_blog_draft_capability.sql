INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'delete_blog_draft', 1, '/delete_blog', 'Delete blog post',
  'workflow.delete_blog@1', 'delete_blog_draft.input@1',
  'delete_blog_draft.output@1', '["astro_repo"]'::jsonb, 'high',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read","vercel:deployments:read"]'::jsonb,
  true, 'webbin-blog-deletion@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable","deployment_pending"]}'::jsonb,
  '{"maxEstimatedCostCents":200,"maxModelCalls":1,"maxTokens":1000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
