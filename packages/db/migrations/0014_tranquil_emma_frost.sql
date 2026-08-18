CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"role" text NOT NULL,
	"decision" text NOT NULL,
	"artifact_id" text NOT NULL,
	"head_commit_sha" text NOT NULL,
	"deployment_id" text NOT NULL,
	"approver_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"retention_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sync_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_revision" text NOT NULL,
	"locale" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"category" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" jsonb,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_catalog_syncs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_revision" text NOT NULL,
	"item_count" integer NOT NULL,
	"status" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_catalog_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"environment" text NOT NULL,
	"commit_sha" text NOT NULL,
	"state" text NOT NULL,
	"urls" jsonb NOT NULL,
	"ready_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deployments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"node" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_artifact_id" text,
	"provider_request_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "publication_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"preconditions" jsonb NOT NULL,
	"status" text NOT NULL,
	"merge_commit_sha" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "publication_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"repo_change_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"url" text NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"state" text NOT NULL,
	"merge_commit_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repo_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"branch" text NOT NULL,
	"files" jsonb NOT NULL,
	"artifact_hashes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"model_calls" integer NOT NULL,
	"tokens" integer NOT NULL,
	"estimated_cost_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_catalog_items" ADD CONSTRAINT "content_catalog_items_sync_id_content_catalog_syncs_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."content_catalog_syncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_catalog_items" ADD CONSTRAINT "content_catalog_items_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_catalog_syncs" ADD CONSTRAINT "content_catalog_syncs_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_change_id_repo_changes_id_fk" FOREIGN KEY ("repo_change_id") REFERENCES "public"."repo_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_changes" ADD CONSTRAINT "repo_changes_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_version_role_unique" ON "approvals" USING btree ("request_version_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_storage_key_unique" ON "artifacts" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_catalog_items_project_source_locale_unique" ON "content_catalog_items" USING btree ("project_id","source_id","locale");--> statement-breakpoint
CREATE INDEX "content_catalog_items_project_slug_idx" ON "content_catalog_items" USING btree ("project_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "content_catalog_syncs_project_revision_unique" ON "content_catalog_syncs" USING btree ("project_id","source_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_provider_id_environment_unique" ON "deployments" USING btree ("provider_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_request_version_unique" ON "pull_requests" USING btree ("request_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_provider_id_unique" ON "pull_requests" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_changes_request_version_unique" ON "repo_changes" USING btree ("request_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_request_version_unique" ON "usage_records" USING btree ("request_version_id");--> statement-breakpoint
CREATE POLICY "approvals_tenant_isolation" ON "approvals" AS PERMISSIVE FOR ALL TO public USING ("approvals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("approvals"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "artifacts_tenant_isolation" ON "artifacts" AS PERMISSIVE FOR ALL TO public USING ("artifacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("artifacts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "content_catalog_items_tenant_isolation" ON "content_catalog_items" AS PERMISSIVE FOR ALL TO public USING ("content_catalog_items"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("content_catalog_items"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "content_catalog_syncs_tenant_isolation" ON "content_catalog_syncs" AS PERMISSIVE FOR ALL TO public USING ("content_catalog_syncs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("content_catalog_syncs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "deployments_tenant_isolation" ON "deployments" AS PERMISSIVE FOR ALL TO public USING ("deployments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("deployments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "model_calls_tenant_isolation" ON "model_calls" AS PERMISSIVE FOR ALL TO public USING ("model_calls"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("model_calls"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "publication_attempts_tenant_isolation" ON "publication_attempts" AS PERMISSIVE FOR ALL TO public USING ("publication_attempts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("publication_attempts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "pull_requests_tenant_isolation" ON "pull_requests" AS PERMISSIVE FOR ALL TO public USING ("pull_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("pull_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "repo_changes_tenant_isolation" ON "repo_changes" AS PERMISSIVE FOR ALL TO public USING ("repo_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("repo_changes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "usage_records_tenant_isolation" ON "usage_records" AS PERMISSIVE FOR ALL TO public USING ("usage_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("usage_records"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "content_catalog_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "content_catalog_syncs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "deployments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "model_calls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "publication_attempts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pull_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "repo_changes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "approvals" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "artifacts" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "content_catalog_items" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "content_catalog_syncs" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "deployments" TO binflow_app;
    GRANT SELECT, INSERT ON "model_calls" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "publication_attempts" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "pull_requests" TO binflow_app;
    GRANT SELECT, INSERT ON "repo_changes" TO binflow_app;
    GRANT SELECT, INSERT ON "usage_records" TO binflow_app;
  END IF;
END
$$;
