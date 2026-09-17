INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'edit_text_shopify', 1, '/edit_text', 'Edit theme text',
  'workflow.edit_text_shopify@1', 'edit_text_shopify.input@1',
  'edit_text_shopify.output@1', '["shopify_liquid"]'::jsonb, 'medium',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read"]'::jsonb,
  true, 'shopify-liquid-text-edit@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable"]}'::jsonb,
  '{"maxEstimatedCostCents":25,"maxModelCalls":1,"maxTokens":500}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
