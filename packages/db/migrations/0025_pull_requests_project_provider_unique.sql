-- GitHub PR numbers are per-repository, not global. Scope uniqueness to the
-- enrolled project so Bistro PR #21 does not collide with Webbin PR #21.
DROP INDEX IF EXISTS "pull_requests_provider_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_project_provider_unique" ON "pull_requests" USING btree ("project_id","provider_id");
