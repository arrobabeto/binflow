CREATE TYPE "public"."request_state" AS ENUM('RECEIVED', 'NEEDS_INPUT', 'AWAITING_PLAN_CONFIRMATION', 'QUEUED', 'GENERATING', 'APPLYING_CHANGE', 'VALIDATING', 'PREVIEW_DEPLOYING', 'PREVIEW_READY', 'REVISION_REQUESTED', 'AWAITING_CLIENT_APPROVAL', 'AWAITING_ADMIN_APPROVAL', 'APPROVED_FOR_PUBLISH', 'REVALIDATING', 'MERGING_OR_PUBLISHING', 'PRODUCTION_DEPLOYING', 'VERIFYING_PRODUCTION', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."workflow_run_status" AS ENUM('waiting', 'queued', 'running', 'interrupted', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "channel_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"bot_credential_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"provider" text DEFAULT 'telegram' NOT NULL,
	"external_user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "channel_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_update_id" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"content_digest" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_users" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"contact_email" text,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending_pairing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_users_id_scope_unique" UNIQUE("id","tenant_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "client_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_identity_id" text NOT NULL,
	"external_chat_id" text NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "graph_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" text NOT NULL,
	"status" "workflow_run_status" NOT NULL,
	"current_node" text NOT NULL,
	"checkpoint_sequence" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"role" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'pending_pairing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"request_version_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "request_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"manifest_version_id" text NOT NULL,
	"capability_version" integer NOT NULL,
	"interpreted_input" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_versions_id_scope_unique" UNIQUE("id","tenant_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "request_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"state" "request_state" NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"topic" text,
	"terminal_result" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_id_scope_unique" UNIQUE("id","tenant_id","project_id"),
	CONSTRAINT "requests_version_check" CHECK ("requests"."version" >= 1),
	CONSTRAINT "requests_current_version_check" CHECK ("requests"."current_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workflow_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_run_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"node" text NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_checkpoints_sequence_check" CHECK ("workflow_checkpoints"."sequence" >= 1)
);
--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD COLUMN "bot_credential_id" text;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_bot_credential_id_provider_credentials_id_fk" FOREIGN KEY ("bot_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_user_scope_fk" FOREIGN KEY ("user_id","tenant_id","project_id") REFERENCES "public"."client_users"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_enrollment_scope_fk" FOREIGN KEY ("enrollment_id","tenant_id","project_id") REFERENCES "public"."client_enrollments"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_identity_id_channel_identities_id_fk" FOREIGN KEY ("channel_identity_id") REFERENCES "public"."channel_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_scope_fk" FOREIGN KEY ("user_id","tenant_id","project_id") REFERENCES "public"."client_users"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_runs" ADD CONSTRAINT "graph_runs_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_scope_fk" FOREIGN KEY ("user_id","tenant_id","project_id") REFERENCES "public"."client_users"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_actions" ADD CONSTRAINT "request_actions_version_scope_fk" FOREIGN KEY ("request_version_id","tenant_id","project_id") REFERENCES "public"."request_versions"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_versions" ADD CONSTRAINT "request_versions_request_scope_fk" FOREIGN KEY ("request_id","tenant_id","project_id") REFERENCES "public"."requests"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_user_scope_fk" FOREIGN KEY ("user_id","tenant_id","project_id") REFERENCES "public"."client_users"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_graph_run_id_graph_runs_id_fk" FOREIGN KEY ("graph_run_id") REFERENCES "public"."graph_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identities_bot_user_unique" ON "channel_identities" USING btree ("bot_id","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identities_user_provider_unique" ON "channel_identities" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_messages_bot_update_unique" ON "channel_messages" USING btree ("bot_id","external_update_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_users_enrollment_unique" ON "client_users" USING btree ("enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_identity_chat_unique" ON "conversations" USING btree ("channel_identity_id","external_chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_runs_request_version_unique" ON "graph_runs" USING btree ("request_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_project_unique" ON "memberships" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_actions_token_hash_unique" ON "request_actions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "request_actions_request_idx" ON "request_actions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_versions_request_version_unique" ON "request_versions" USING btree ("request_id","version");--> statement-breakpoint
CREATE INDEX "requests_project_updated_idx" ON "requests" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_checkpoints_run_sequence_unique" ON "workflow_checkpoints" USING btree ("graph_run_id","sequence");--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD CONSTRAINT "pairing_tokens_user_scope_fk" FOREIGN KEY ("user_id","tenant_id","project_id") REFERENCES "public"."client_users"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "channel_identities_tenant_isolation" ON "channel_identities" AS PERMISSIVE FOR ALL TO public USING ("channel_identities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("channel_identities"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "channel_messages_tenant_isolation" ON "channel_messages" AS PERMISSIVE FOR ALL TO public USING ("channel_messages"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("channel_messages"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "client_users_tenant_isolation" ON "client_users" AS PERMISSIVE FOR ALL TO public USING ("client_users"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("client_users"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "conversations_tenant_isolation" ON "conversations" AS PERMISSIVE FOR ALL TO public USING ("conversations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("conversations"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "graph_runs_tenant_isolation" ON "graph_runs" AS PERMISSIVE FOR ALL TO public USING ("graph_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("graph_runs"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO public USING ("memberships"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("memberships"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "request_actions_tenant_isolation" ON "request_actions" AS PERMISSIVE FOR ALL TO public USING ("request_actions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("request_actions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "request_versions_tenant_isolation" ON "request_versions" AS PERMISSIVE FOR ALL TO public USING ("request_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("request_versions"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "requests_tenant_isolation" ON "requests" AS PERMISSIVE FOR ALL TO public USING ("requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "workflow_checkpoints_tenant_isolation" ON "workflow_checkpoints" AS PERMISSIVE FOR ALL TO public USING ("workflow_checkpoints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("workflow_checkpoints"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
UPDATE "pairing_tokens"
SET "revoked_at" = now()
WHERE "consumed_at" IS NULL
  AND "revoked_at" IS NULL
  AND ("user_id" IS NULL OR "bot_credential_id" IS NULL);
--> statement-breakpoint
ALTER TABLE "pairing_tokens"
ADD CONSTRAINT "pairing_tokens_bot_credential_fk"
FOREIGN KEY ("bot_credential_id") REFERENCES "provider_credentials"("id");
--> statement-breakpoint
ALTER TABLE "channel_identities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "channel_messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "client_users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "graph_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "request_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "request_versions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workflow_checkpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION reject_workflow_checkpoint_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workflow checkpoints are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_checkpoints_append_only
BEFORE UPDATE OR DELETE ON "workflow_checkpoints"
FOR EACH ROW EXECUTE FUNCTION reject_workflow_checkpoint_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "channel_identities" TO binflow_app;
    GRANT SELECT, INSERT ON "channel_messages" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "client_users" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "conversations" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "graph_runs" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "memberships" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "request_actions" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "request_versions" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "requests" TO binflow_app;
    GRANT SELECT, INSERT ON "workflow_checkpoints" TO binflow_app;
  END IF;
END
$$;
