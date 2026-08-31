INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'create_blog_orbitype', 1, '/create_blog', 'Create blog',
  'workflow.create_blog_orbitype@1', 'create_blog_orbitype.input@1',
  'create_blog_orbitype.output@1', '["astro_orbitype"]'::jsonb, 'medium',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read","vercel:deployments:read","orbitype:content:write"]'::jsonb,
  true, 'astro-orbitype-blog-publication@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable","deployment_pending"]}'::jsonb,
  '{"maxEstimatedCostCents":500,"maxModelCalls":12,"maxTokens":120000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
