CREATE TYPE "public"."project_manifest_status" AS ENUM('draft', 'validated', 'active', 'superseded');--> statement-breakpoint
CREATE TABLE "project_budget_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"manifest_version_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"max_requests_per_day" integer NOT NULL,
	"max_model_calls_per_request" integer NOT NULL,
	"max_tokens_per_request" integer NOT NULL,
	"max_estimated_cost_cents_per_request" integer NOT NULL,
	"max_estimated_cost_cents_per_day" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_policies_positive_check" CHECK ("project_budget_policies"."max_requests_per_day" >= 1 AND "project_budget_policies"."max_model_calls_per_request" >= 1 AND "project_budget_policies"."max_tokens_per_request" >= 1000 AND "project_budget_policies"."max_estimated_cost_cents_per_request" >= 1 AND "project_budget_policies"."max_estimated_cost_cents_per_day" >= "project_budget_policies"."max_estimated_cost_cents_per_request")
);
--> statement-breakpoint
ALTER TABLE "project_budget_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_locales" (
	"id" text PRIMARY KEY NOT NULL,
	"manifest_version_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"conversation_locale" text NOT NULL,
	"content_locales" jsonb NOT NULL,
	"default_content_locale" text NOT NULL,
	"required_content_locales" jsonb NOT NULL,
	"slug_locale" text NOT NULL,
	"translation_policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_locales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_manifest_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "project_manifest_status" NOT NULL,
	"profile" text NOT NULL,
	"global_profile_version" text NOT NULL,
	"dependency_fingerprint" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_manifest_versions_id_scope_unique" UNIQUE("id","tenant_id","project_id"),
	CONSTRAINT "project_manifest_versions_version_check" CHECK ("project_manifest_versions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "project_manifest_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "active_manifest_version" integer;--> statement-breakpoint
ALTER TABLE "project_budget_policies" ADD CONSTRAINT "project_budget_policies_manifest_scope_fk" FOREIGN KEY ("manifest_version_id","tenant_id","project_id") REFERENCES "public"."project_manifest_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_policies" ADD CONSTRAINT "project_budget_policies_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_locales" ADD CONSTRAINT "project_locales_manifest_scope_fk" FOREIGN KEY ("manifest_version_id","tenant_id","project_id") REFERENCES "public"."project_manifest_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_locales" ADD CONSTRAINT "project_locales_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manifest_versions" ADD CONSTRAINT "project_manifest_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_manifest_versions" ADD CONSTRAINT "project_manifest_versions_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_budget_policies_manifest_unique" ON "project_budget_policies" USING btree ("manifest_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_locales_manifest_unique" ON "project_locales" USING btree ("manifest_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_manifest_versions_project_version_unique" ON "project_manifest_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "project_manifest_versions_project_idx" ON "project_manifest_versions" USING btree ("project_id","version");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_manifest_version_check" CHECK ("projects"."active_manifest_version" IS NULL OR "projects"."active_manifest_version" >= 1);--> statement-breakpoint
CREATE POLICY "project_budget_policies_tenant_isolation" ON "project_budget_policies" AS PERMISSIVE FOR ALL TO public USING ("project_budget_policies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("project_budget_policies"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "project_locales_tenant_isolation" ON "project_locales" AS PERMISSIVE FOR ALL TO public USING ("project_locales"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("project_locales"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "project_manifest_versions_tenant_isolation" ON "project_manifest_versions" AS PERMISSIVE FOR ALL TO public USING ("project_manifest_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("project_manifest_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "project_manifest_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_locales" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_budget_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION reject_project_manifest_content_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'project manifest versions cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.profile IS DISTINCT FROM OLD.profile
    OR NEW.global_profile_version IS DISTINCT FROM OLD.global_profile_version
    OR NEW.dependency_fingerprint IS DISTINCT FROM OLD.dependency_fingerprint
    OR NEW.document IS DISTINCT FROM OLD.document
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'project manifest content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_manifest_versions_immutable_content
BEFORE UPDATE OR DELETE ON "project_manifest_versions"
FOR EACH ROW EXECUTE FUNCTION reject_project_manifest_content_mutation();
--> statement-breakpoint
CREATE FUNCTION reject_project_manifest_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'project manifest snapshots are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_locales_append_only
BEFORE UPDATE OR DELETE ON "project_locales"
FOR EACH ROW EXECUTE FUNCTION reject_project_manifest_snapshot_mutation();
--> statement-breakpoint
CREATE TRIGGER project_budget_policies_append_only
BEFORE UPDATE OR DELETE ON "project_budget_policies"
FOR EACH ROW EXECUTE FUNCTION reject_project_manifest_snapshot_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "project_manifest_versions" TO binflow_app;
    GRANT SELECT, INSERT ON "project_locales" TO binflow_app;
    GRANT SELECT, INSERT ON "project_budget_policies" TO binflow_app;
  END IF;
END
$$;
