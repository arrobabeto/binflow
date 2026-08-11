ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "external_resource_id" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "provider_credentials"
SET
	"external_resource_id" = "verification_evidence" ->> 'externalResourceId',
	"verified_at" = "tested_at"
WHERE "status" = 'active';--> statement-breakpoint
UPDATE "integration_connections"
SET
	"external_resource_id" = coalesce("external_resource_id", "verification_evidence" ->> 'externalResourceId'),
	"verified_at" = "tested_at"
WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "projects_id_tenant_unique" ON "projects" USING btree ("id","tenant_id");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_active_telegram_bot_unique" ON "provider_credentials" USING btree ("external_resource_id") WHERE "provider_credentials"."status" = 'active' AND "provider_credentials"."kind" IN ('telegram-admin', 'telegram-client') AND "provider_credentials"."external_resource_id" IS NOT NULL;
