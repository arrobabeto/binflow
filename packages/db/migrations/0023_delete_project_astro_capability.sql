INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'delete_project_astro', 2, '/delete_project', 'Delete portfolio project',
  'workflow.delete_project@1', 'delete_project_astro.input@1',
  'delete_project_astro.output@1', '["astro_repo"]'::jsonb, 'high',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read","vercel:deployments:read"]'::jsonb,
  false, 'webbin-project-deletion@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable","deployment_pending"]}'::jsonb,
  '{"maxEstimatedCostCents":200,"maxModelCalls":1,"maxTokens":1000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
