INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'edit_text', 1, '/edit_text', 'Edit page text',
  'workflow.edit_text@1', 'edit_text.input@1',
  'edit_text.output@1', '["astro_orbitype"]'::jsonb, 'medium',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read","vercel:deployments:read","orbitype:content:read","orbitype:content:write"]'::jsonb,
  true, 'astro-orbitype-text-edit@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable","deployment_pending"]}'::jsonb,
  '{"maxEstimatedCostCents":50,"maxModelCalls":1,"maxTokens":1000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
