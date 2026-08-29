INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'create_project_astro', 1, '/create_project', 'Create portfolio project',
  'workflow.create_project@1', 'create_project_astro.input@1',
  'create_project_astro.output@1', '["astro_repo"]'::jsonb, 'medium',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read","vercel:deployments:read"]'::jsonb,
  true, 'webbin-project-publication@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable","deployment_pending"]}'::jsonb,
  '{"maxEstimatedCostCents":500,"maxModelCalls":12,"maxTokens":120000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
