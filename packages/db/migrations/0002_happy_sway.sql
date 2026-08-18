CREATE TYPE "public"."credential_owner_scope" AS ENUM('platform', 'tenant', 'project');--> statement-breakpoint
ALTER TYPE "public"."integration_status" ADD VALUE 'superseded' BEFORE 'revoked';--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"project_id" text,
	"credential_id" text NOT NULL,
	"kind" text NOT NULL,
	"external_resource_id" text,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integration_status" DEFAULT 'unverified' NOT NULL,
	"tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "provider_credentials_scope_kind_version_unique";--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "owner_scope" "credential_owner_scope";--> statement-breakpoint
UPDATE "provider_credentials"
SET "owner_scope" = CASE
	WHEN "kind" = 'telegram-admin' THEN 'platform'::"credential_owner_scope"
	WHEN "kind" = 'github-app' THEN 'project'::"credential_owner_scope"
	WHEN "kind" = 'vercel' THEN 'project'::"credential_owner_scope"
	ELSE 'tenant'::"credential_owner_scope"
END;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "owner_scope" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "configuration" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "verification_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "provider_credentials"
SET "status" = 'revoked', "revoked_at" = coalesce("revoked_at", now());--> statement-breakpoint
UPDATE "secret_references" AS "secret"
SET "revoked_at" = coalesce("secret"."revoked_at", now())
FROM "provider_credentials" AS "credential"
WHERE "credential"."secret_reference_id" = "secret"."id";--> statement-breakpoint
INSERT INTO "credential_events" ("id", "credential_id", "tenant_id", "project_id", "action", "metadata")
SELECT
	'migration-0002-revoked:' || "id",
	"id",
	"tenant_id",
	"project_id",
	'revoked',
	jsonb_build_object('migration', '0002', 'reason', 'legacy_bundle_reenrollment_required')
FROM "provider_credentials"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_connections_tenant_idx" ON "integration_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "integration_connections_project_idx" ON "integration_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "integration_connections_credential_idx" ON "integration_connections" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_project_kind_credential_unique" ON "integration_connections" USING btree ("tenant_id","project_id","kind","credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_one_active_per_scope_unique" ON "provider_credentials" USING btree ("owner_scope",coalesce("tenant_id", 'platform'),coalesce("project_id", 'platform'),"kind") WHERE "provider_credentials"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_scope_kind_version_unique" ON "provider_credentials" USING btree ("owner_scope",coalesce("tenant_id", 'platform'),coalesce("project_id", 'platform'),"kind","version");--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_owner_scope_check" CHECK (("provider_credentials"."owner_scope" = 'platform' AND "provider_credentials"."tenant_id" IS NULL AND "provider_credentials"."project_id" IS NULL) OR ("provider_credentials"."owner_scope" = 'tenant' AND "provider_credentials"."tenant_id" IS NOT NULL AND "provider_credentials"."project_id" IS NULL) OR ("provider_credentials"."owner_scope" = 'project' AND "provider_credentials"."tenant_id" IS NOT NULL AND "provider_credentials"."project_id" IS NOT NULL));--> statement-breakpoint
CREATE POLICY "integration_connections_tenant_isolation" ON "integration_connections" AS PERMISSIVE FOR ALL TO public USING ("integration_connections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("integration_connections"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
