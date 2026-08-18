CREATE TABLE "capability_definitions" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"command" text NOT NULL,
	"display_name" text NOT NULL,
	"executor_id" text NOT NULL,
	"input_schema_id" text NOT NULL,
	"output_schema_id" text NOT NULL,
	"allowed_profiles" jsonb NOT NULL,
	"risk_class" text NOT NULL,
	"required_permissions" jsonb NOT NULL,
	"requires_preview" boolean NOT NULL,
	"approval_policy_id" text NOT NULL,
	"timeout_seconds" integer NOT NULL,
	"retry_policy" jsonb NOT NULL,
	"budget_policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_definitions_id_version_unique" UNIQUE("id","version"),
	CONSTRAINT "capability_definitions_version_check" CHECK ("capability_definitions"."version" >= 1),
	CONSTRAINT "capability_definitions_timeout_check" CHECK ("capability_definitions"."timeout_seconds" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_capability_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"manifest_version_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"capability_version" integer NOT NULL,
	"access" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_capability_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_capability_bindings" ADD CONSTRAINT "project_capability_bindings_definition_fk" FOREIGN KEY ("capability_id","capability_version") REFERENCES "public"."capability_definitions"("id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_capability_bindings" ADD CONSTRAINT "project_capability_bindings_manifest_scope_fk" FOREIGN KEY ("manifest_version_id","tenant_id","project_id") REFERENCES "public"."project_manifest_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_capability_bindings" ADD CONSTRAINT "project_capability_bindings_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_capability_bindings_manifest_capability_unique" ON "project_capability_bindings" USING btree ("manifest_version_id","capability_id");--> statement-breakpoint
CREATE POLICY "project_capability_bindings_tenant_isolation" ON "project_capability_bindings" AS PERMISSIVE FOR ALL TO public USING ("project_capability_bindings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("project_capability_bindings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "project_capability_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO "capability_definitions" (
  "id", "version", "command", "display_name", "executor_id",
  "input_schema_id", "output_schema_id", "allowed_profiles", "risk_class",
  "required_permissions", "requires_preview", "approval_policy_id",
  "timeout_seconds", "retry_policy", "budget_policy"
) VALUES (
  'create_blog_draft', 1, '/create_blog', 'Create blog',
  'workflow.create_blog@1', 'create_blog_draft.input@1',
  'create_blog_draft.output@1', '["astro_repo"]'::jsonb, 'medium',
  '["github:metadata:read","github:contents:write","github:pull_requests:write","github:checks:read","github:statuses:read","vercel:deployments:read"]'::jsonb,
  true, 'webbin-blog-publication@1', 1800,
  '{"maxAttempts":3,"retryableErrors":["provider_retryable","deployment_pending"]}'::jsonb,
  '{"maxEstimatedCostCents":500,"maxModelCalls":12,"maxTokens":120000}'::jsonb
) ON CONFLICT ("id", "version") DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION reject_capability_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'capability definitions and bindings are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER capability_definitions_append_only
BEFORE UPDATE OR DELETE ON "capability_definitions"
FOR EACH ROW EXECUTE FUNCTION reject_capability_snapshot_mutation();
--> statement-breakpoint
CREATE TRIGGER project_capability_bindings_append_only
BEFORE UPDATE OR DELETE ON "project_capability_bindings"
FOR EACH ROW EXECUTE FUNCTION reject_capability_snapshot_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT ON "capability_definitions" TO binflow_app;
    GRANT SELECT, INSERT ON "project_capability_bindings" TO binflow_app;
  END IF;
END
$$;
