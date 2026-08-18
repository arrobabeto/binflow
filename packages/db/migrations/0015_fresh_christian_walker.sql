CREATE TABLE "admin_notification_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_credential_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_pairing_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_credential_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_heartbeats" (
	"service" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_notification_targets" ADD CONSTRAINT "admin_notification_targets_bot_credential_id_provider_credentials_id_fk" FOREIGN KEY ("bot_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_pairing_tokens" ADD CONSTRAINT "admin_pairing_tokens_bot_credential_id_provider_credentials_id_fk" FOREIGN KEY ("bot_credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_notification_targets_bot_unique" ON "admin_notification_targets" USING btree ("bot_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_notification_targets_identity_unique" ON "admin_notification_targets" USING btree ("bot_id","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_pairing_tokens_hash_unique" ON "admin_pairing_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_pairing_tokens_bot_idx" ON "admin_pairing_tokens" USING btree ("bot_credential_id");
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "admin_notification_targets" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "admin_pairing_tokens" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE ON "service_heartbeats" TO binflow_app;
  END IF;
END
$$;
