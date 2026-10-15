INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'create_blog_wordpress', 1, '/create_blog', 'Create blog',
  'workflow.create_blog_wordpress@1', 'create_blog_wordpress.input@1',
  'create_blog_wordpress.output@1', '["wordpress_rest"]'::jsonb, 'medium',
  '["wordpress:posts:write","wordpress:media:write","wordpress:categories:write"]'::jsonb,
  true, 'wordpress-rest-blog-publication@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable"]}'::jsonb,
  '{"maxEstimatedCostCents":400,"maxModelCalls":6,"maxTokens":80000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
