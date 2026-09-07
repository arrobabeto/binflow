CREATE TABLE "binn_threads" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "binn_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "binn_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"action" text NOT NULL,
	"token_hash" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "binn_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "binn_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capability_id" text DEFAULT 'hey_binn' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_cents" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"provider_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "binn_usage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "binn_threads" ADD CONSTRAINT "binn_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binn_actions" ADD CONSTRAINT "binn_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "binn_threads_project_activity_idx" ON "binn_threads" USING btree ("project_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "binn_actions_token_hash_unique" ON "binn_actions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "binn_actions_conversation_idx" ON "binn_actions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "binn_usage_events_project_created_idx" ON "binn_usage_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "binn_usage_events_created_idx" ON "binn_usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "binn_threads_tenant_isolation" ON "binn_threads" AS PERMISSIVE FOR ALL TO public USING ("binn_threads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("binn_threads"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
CREATE POLICY "binn_actions_tenant_isolation" ON "binn_actions" AS PERMISSIVE FOR ALL TO public USING ("binn_actions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("binn_actions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
CREATE POLICY "binn_usage_events_tenant_isolation" ON "binn_usage_events" AS PERMISSIVE FOR ALL TO public USING ("binn_usage_events"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("binn_usage_events"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "binn_threads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "binn_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "binn_usage_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "binn_threads" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "binn_actions" TO binflow_app;
    GRANT SELECT, INSERT ON "binn_usage_events" TO binflow_app;
  END IF;
END $$;
