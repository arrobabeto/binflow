CREATE TYPE "public"."enrollment_state" AS ENUM('draft', 'configuring', 'validating', 'validation_failed', 'ready_for_pairing', 'pairing_pending', 'active', 'revalidation_required', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."enrollment_validation_result" AS ENUM('success', 'failed', 'blocked');--> statement-breakpoint
CREATE TABLE "client_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"state" "enrollment_state" DEFAULT 'draft' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_enrollments_id_scope_unique" UNIQUE("id","tenant_id","project_id"),
	CONSTRAINT "client_enrollments_current_step_check" CHECK ("client_enrollments"."current_step" >= 1 AND "client_enrollments"."current_step" <= 11),
	CONSTRAINT "client_enrollments_version_check" CHECK ("client_enrollments"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "client_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "enrollment_validation_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"check_name" text NOT NULL,
	"check_version" integer NOT NULL,
	"dependency_fingerprint" text NOT NULL,
	"result" "enrollment_validation_result" NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_category" text,
	"error_code" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_validation_attempts_check_version_check" CHECK ("enrollment_validation_attempts"."check_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "enrollment_validation_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pairing_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pairing_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_enrollments" ADD CONSTRAINT "client_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_enrollments" ADD CONSTRAINT "client_enrollments_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_validation_attempts" ADD CONSTRAINT "enrollment_validation_attempts_enrollment_scope_fk" FOREIGN KEY ("enrollment_id","tenant_id","project_id") REFERENCES "public"."client_enrollments"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_validation_attempts" ADD CONSTRAINT "enrollment_validation_attempts_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD CONSTRAINT "pairing_tokens_enrollment_scope_fk" FOREIGN KEY ("enrollment_id","tenant_id","project_id") REFERENCES "public"."client_enrollments"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD CONSTRAINT "pairing_tokens_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_enrollments_tenant_unique" ON "client_enrollments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_enrollments_project_unique" ON "client_enrollments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "enrollment_validation_attempts_enrollment_idx" ON "enrollment_validation_attempts" USING btree ("enrollment_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_tokens_hash_unique" ON "pairing_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pairing_tokens_enrollment_idx" ON "pairing_tokens" USING btree ("enrollment_id");--> statement-breakpoint
CREATE POLICY "client_enrollments_tenant_isolation" ON "client_enrollments" AS PERMISSIVE FOR ALL TO public USING ("client_enrollments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("client_enrollments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "enrollment_validation_attempts_tenant_isolation" ON "enrollment_validation_attempts" AS PERMISSIVE FOR ALL TO public USING ("enrollment_validation_attempts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("enrollment_validation_attempts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');--> statement-breakpoint
CREATE POLICY "pairing_tokens_tenant_isolation" ON "pairing_tokens" AS PERMISSIVE FOR ALL TO public USING ("pairing_tokens"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("pairing_tokens"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "client_enrollments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "enrollment_validation_attempts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pairing_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION reject_enrollment_validation_attempt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'enrollment validation attempts are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enrollment_validation_attempts_append_only
BEFORE UPDATE OR DELETE ON "enrollment_validation_attempts"
FOR EACH ROW EXECUTE FUNCTION reject_enrollment_validation_attempt_mutation();
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binflow_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_enrollments" TO binflow_app;
    GRANT SELECT, INSERT ON "enrollment_validation_attempts" TO binflow_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "pairing_tokens" TO binflow_app;
  END IF;
END
$$;
