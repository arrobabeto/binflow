ALTER TABLE "provider_credentials" DROP CONSTRAINT "provider_credentials_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "secret_references" DROP CONSTRAINT "secret_references_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_credential_unique" ON "integration_connections" USING btree ("credential_id");