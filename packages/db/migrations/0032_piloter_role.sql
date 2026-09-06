ALTER TABLE "client_users" ADD COLUMN "kind" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
UPDATE "client_users" SET "kind" = 'owner' WHERE "kind" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "client_users_enrollment_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "client_users_enrollment_owner_unique" ON "client_users" USING btree ("enrollment_id") WHERE "kind" = 'owner';
--> statement-breakpoint
CREATE UNIQUE INDEX "client_users_enrollment_piloter_unique" ON "client_users" USING btree ("enrollment_id") WHERE "kind" = 'piloter';
--> statement-breakpoint
ALTER TABLE "pairing_tokens" ADD COLUMN "purpose" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "client_actor_role" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "opener_user_id" text;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "client_actor_role" text DEFAULT 'owner' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opener_user_scope_fk" FOREIGN KEY ("opener_user_id","tenant_id","project_id") REFERENCES "public"."client_users"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "piloter_capability_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "piloter_capability_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "piloter_capability_bindings" ADD CONSTRAINT "piloter_capability_bindings_enrollment_scope_fk" FOREIGN KEY ("enrollment_id","tenant_id","project_id") REFERENCES "public"."client_enrollments"("id","tenant_id","project_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "piloter_capability_bindings" ADD CONSTRAINT "piloter_capability_bindings_project_tenant_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "piloter_capability_bindings_enrollment_capability_unique" ON "piloter_capability_bindings" USING btree ("enrollment_id","capability_id");
--> statement-breakpoint
CREATE POLICY "piloter_capability_bindings_tenant_isolation" ON "piloter_capability_bindings" AS PERMISSIVE FOR ALL TO public USING ("piloter_capability_bindings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true') WITH CHECK ("piloter_capability_bindings"."tenant_id" = nullif(current_setting('app.tenant_id', true), '') OR current_setting('app.platform_owner', true) = 'true');
--> statement-breakpoint
ALTER TABLE "piloter_capability_bindings" FORCE ROW LEVEL SECURITY;
