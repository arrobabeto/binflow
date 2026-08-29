CREATE TABLE "project_tool_customizations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_tool_customizations_version_positive" CHECK ("project_tool_customizations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "project_tool_customizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_tool_customizations" ADD CONSTRAINT "project_tool_customizations_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_tool_customizations_project_capability_version" ON "project_tool_customizations" USING btree ("project_id","capability_id","version");--> statement-breakpoint
CREATE POLICY "project_tool_customizations_tenant_isolation" ON "project_tool_customizations" AS PERMISSIVE FOR ALL TO public USING ("project_tool_customizations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("project_tool_customizations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "project_tool_customizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION binflow_reject_project_tool_customization_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'project_tool_customizations rows are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER project_tool_customizations_append_only
BEFORE UPDATE OR DELETE ON project_tool_customizations
FOR EACH ROW
EXECUTE FUNCTION binflow_reject_project_tool_customization_mutation();
--> statement-breakpoint
GRANT SELECT, INSERT ON project_tool_customizations TO binflow_app;
