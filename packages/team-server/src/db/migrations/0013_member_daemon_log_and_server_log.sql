-- description: member_daemon_log (per-member uploaded daemon sync log) + server_log (durable server app log across reboots)
-- New tables only (expand-safe). Hand-authored orphan migration: the migrate
-- runner's fallback applier picks up .sql files not in _journal.json and
-- records their hash, same as 0009-0012. FKs inlined, IF NOT EXISTS so the
-- fallback apply is idempotent.

-- The member's own daemon sync log, uploaded via the metrics push. Row-level
-- dedup on (membership_id, ts, msg) so retried pushes are idempotent.
CREATE TABLE IF NOT EXISTS "member_daemon_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
	"membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
	"ts" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"msg" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_member_daemon_log_dedup" ON "member_daemon_log" USING btree ("membership_id","ts","msg");
CREATE INDEX IF NOT EXISTS "idx_member_daemon_log_member" ON "member_daemon_log" USING btree ("membership_id","ts" DESC);

-- Durable mirror of the server's own console output, so the raw application
-- log survives a reboot/redeploy. `seq` is assigned by the in-memory buffer
-- (log-buffer.ts) and flushed here in batches; the viewer hydrates from this
-- on boot.
CREATE TABLE IF NOT EXISTS "server_log" (
	"seq" bigint PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"msg" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_server_log_ts" ON "server_log" USING btree ("ts" DESC);
