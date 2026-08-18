CREATE TABLE "candidate_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"similarity_check_id" text NOT NULL,
	"source_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"score_basis_points" integer NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_matches_score_range" CHECK ("candidate_matches"."score_basis_points" >= -10000 AND "candidate_matches"."score_basis_points" <= 10000),
	CONSTRAINT "candidate_matches_rank_positive" CHECK ("candidate_matches"."rank" > 0)
);
--> statement-breakpoint
ALTER TABLE "candidate_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "similarity_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"catalog_sync_id" text NOT NULL,
	"intent_hash" text NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "similarity_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_matches" ADD CONSTRAINT "candidate_matches_similarity_check_id_similarity_checks_id_fk" FOREIGN KEY ("similarity_check_id") REFERENCES "public"."similarity_checks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_matches" ADD CONSTRAINT "candidate_matches_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "similarity_checks" ADD CONSTRAINT "similarity_checks_catalog_sync_id_content_catalog_syncs_id_fk" FOREIGN KEY ("catalog_sync_id") REFERENCES "public"."content_catalog_syncs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "similarity_checks" ADD CONSTRAINT "similarity_checks_request_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_matches_check_rank_unique" ON "candidate_matches" USING btree ("similarity_check_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "similarity_checks_request_version_unique" ON "similarity_checks" USING btree ("request_version_id");--> statement-breakpoint
CREATE POLICY "candidate_matches_tenant_isolation" ON "candidate_matches" AS PERMISSIVE FOR ALL TO public USING ("candidate_matches"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("candidate_matches"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "similarity_checks_tenant_isolation" ON "similarity_checks" AS PERMISSIVE FOR ALL TO public USING ("similarity_checks"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("similarity_checks"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "candidate_matches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "similarity_checks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "candidate_matches" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "similarity_checks" TO binflow_app;
  END IF;
END
$$;
