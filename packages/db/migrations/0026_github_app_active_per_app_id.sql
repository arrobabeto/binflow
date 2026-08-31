-- Distinct GitHub App registrations (different configuration.appId) may be
-- active at the same platform scope. Same-app rotations still collide.
DROP INDEX IF EXISTS "provider_credentials_one_active_per_scope_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_one_active_per_scope_unique" ON "provider_credentials" USING btree ("owner_scope",coalesce("tenant_id", 'platform'),coalesce("project_id", 'platform'),"kind",coalesce("configuration"->>'appId', '')) WHERE "provider_credentials"."status" = 'active';
