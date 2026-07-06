-- description: member_sync_log — per-push sync health, powers the in-UI "View logs" panel
-- New table only (expand-safe; old code ignores it). Hand-authored orphan
-- migration: the migrate runner's fallback applier picks up .sql files not in
-- _journal.json and records their hash, same as 0009/0010/0011. FKs inlined and
-- IF NOT EXISTS used so the fallback apply is idempotent.
CREATE TABLE IF NOT EXISTS "member_sync_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
	"membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
	"ingest_id" text NOT NULL,
	"cli_version" text,
	"accepted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skipped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"dedup" boolean DEFAULT false NOT NULL,
	"hist_inserted" integer DEFAULT 0 NOT NULL,
	"hist_received" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_member_sync_log_member" ON "member_sync_log" USING btree ("membership_id","created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_member_sync_log_created" ON "member_sync_log" USING btree ("created_at");
