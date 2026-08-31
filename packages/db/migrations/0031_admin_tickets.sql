CREATE TYPE "public"."ticket_state" AS ENUM('new', 'in_process', 'declined', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'medium', 'high');
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"body" text NOT NULL,
	"state" "ticket_state" DEFAULT 'new' NOT NULL,
	"priority" "ticket_priority",
	"category" text,
	"admin_notes" text DEFAULT '' NOT NULL,
	"read_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_version_positive" CHECK ("tickets"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ticket_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"actor_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activities" ADD CONSTRAINT "ticket_activities_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_activities" ADD CONSTRAINT "ticket_activities_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_public_id_unique" ON "tickets" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "tickets_tab_updated_idx" ON "tickets" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "tickets_project_updated_idx" ON "tickets" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "ticket_activities_ticket_created_idx" ON "ticket_activities" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE POLICY "tickets_tenant_isolation" ON "tickets" AS PERMISSIVE FOR ALL TO public USING ("tickets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("tickets"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
CREATE POLICY "ticket_activities_tenant_isolation" ON "ticket_activities" AS PERMISSIVE FOR ALL TO public USING ("ticket_activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("ticket_activities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ticket_activities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "tickets" TO binflow_app;
    GRANT SELECT, INSERT ON "ticket_activities" TO binflow_app;
  END IF;
END $$;
