CREATE TYPE "public"."integration_status" AS ENUM('unverified', 'active', 'invalid', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('draft', 'active', 'suspended', 'archived');--> statement-breakpoint
CREATE TABLE "credential_events" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"tenant_id" text,
	"project_id" text,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"profile" text DEFAULT 'astro_repo' NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"project_id" text,
	"kind" text NOT NULL,
	"alias" text NOT NULL,
	"secret_reference_id" text NOT NULL,
	"masked_suffix" text NOT NULL,
	"status" "integration_status" DEFAULT 'unverified' NOT NULL,
	"version" integer NOT NULL,
	"tested_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_references" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"project_id" text,
	"provider" text NOT NULL,
	"credential_version" integer NOT NULL,
	"key_version" integer NOT NULL,
	"algorithm" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"wrap_nonce" text NOT NULL,
	"wrap_auth_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'draft' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_events" ADD CONSTRAINT "credential_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_secret_reference_id_secret_references_id_fk" FOREIGN KEY ("secret_reference_id") REFERENCES "public"."secret_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_events_credential_idx" ON "credential_events" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_tenant_key_unique" ON "projects" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "projects_tenant_idx" ON "projects" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "provider_credentials_tenant_idx" ON "provider_credentials" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "provider_credentials_project_idx" ON "provider_credentials" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_scope_kind_version_unique" ON "provider_credentials" USING btree ("tenant_id","project_id","kind","version");--> statement-breakpoint
CREATE INDEX "secret_references_tenant_idx" ON "secret_references" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "secret_references_project_idx" ON "secret_references" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_key_unique" ON "tenants" USING btree ("key");
