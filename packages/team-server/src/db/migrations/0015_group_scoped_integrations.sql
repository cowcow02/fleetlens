-- description: many integrations per provider — new integrations table (rows copied from team_integrations) + integration_id provenance on synced fact tables
-- Hand-authored orphan migration (same pattern as 0009-0014): the migrate
-- runner's fallback applier picks up .sql files not in _journal.json.
-- Expand-only: the previous container upserts team_integrations via
-- ON CONFLICT (team_id, provider), so that table (and its PK) must survive
-- this release untouched. It is dropped next release (two-release DROP).

CREATE TABLE IF NOT EXISTS "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"owner_group_id" uuid,
	"credentials_enc" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_provider_check" CHECK ("provider" IN ('github', 'jira', 'linear')),
	CONSTRAINT "integrations_status_check" CHECK ("status" IN ('active', 'error'))
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_owner_group_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_team_provider_label_key" ON "integrations" USING btree ("team_id","provider","label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_integrations_team" ON "integrations" USING btree ("team_id","provider");
--> statement-breakpoint
INSERT INTO "integrations" (team_id, provider, label, credentials_enc, config, status, last_error, last_sync_at, created_by, created_at)
SELECT team_id, provider,
       CASE provider WHEN 'github' THEN 'GitHub' WHEN 'jira' THEN 'Jira' ELSE 'Linear' END,
       credentials_enc, config, status, last_error, last_sync_at, created_by, created_at
FROM "team_integrations"
ON CONFLICT ("team_id", "provider", "label") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD COLUMN IF NOT EXISTS "integration_id" uuid;
--> statement-breakpoint
ALTER TABLE "github_pull_requests" ADD CONSTRAINT "github_pull_requests_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "linear_issues" ADD COLUMN IF NOT EXISTS "integration_id" uuid;
--> statement-breakpoint
ALTER TABLE "linear_issues" ADD CONSTRAINT "linear_issues_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jira_issues" ADD COLUMN IF NOT EXISTS "integration_id" uuid;
--> statement-breakpoint
ALTER TABLE "jira_issues" ADD CONSTRAINT "jira_issues_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Non-concurrent indexes on existing tables: allowed here because these fact
-- tables are retention-pruned (per-team retention_days, daily job) so they
-- stay bounded, and CREATE INDEX CONCURRENTLY cannot run inside the
-- migration transaction the drizzle runner uses.
CREATE INDEX IF NOT EXISTS "idx_github_prs_integration" ON "github_pull_requests" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_linear_issues_integration" ON "linear_issues" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jira_issues_integration" ON "jira_issues" USING btree ("integration_id");
--> statement-breakpoint
-- The three backfills below assume at most one integrations row per (team, provider),
-- true at migration time (the source table's PK). Re-running after managers have added
-- more connections would stamp remaining NULL rows with an arbitrary same-provider row;
-- acceptable for a one-time backfill, bounded by the IS NULL filter.
UPDATE "github_pull_requests" p SET "integration_id" = i.id FROM "integrations" i WHERE p."integration_id" IS NULL AND i.team_id = p.team_id AND i.provider = 'github';
--> statement-breakpoint
UPDATE "linear_issues" l SET "integration_id" = i.id FROM "integrations" i WHERE l."integration_id" IS NULL AND i.team_id = l.team_id AND i.provider = 'linear';
--> statement-breakpoint
UPDATE "jira_issues" j SET "integration_id" = i.id FROM "integrations" i WHERE j."integration_id" IS NULL AND i.team_id = j.team_id AND i.provider = 'jira';
