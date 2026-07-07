-- description: index member_daemon_log (membership_id, id DESC) for the id-keyset log page query
-- Index-only change (expand-safe). Hand-authored orphan migration: the
-- migrate runner's fallback applier picks up .sql files not in _journal.json
-- and records their hash, same as 0009-0013. IF NOT EXISTS so the fallback
-- apply is idempotent; non-concurrent is fine — the table is new (0013) and
-- 30-day pruned, so it stays small.

-- loadMemberDaemonLogPage orders and keyset-paginates by id, but only
-- (membership_id, ts DESC) existed — every page sorted the member's whole log.
CREATE INDEX IF NOT EXISTS "idx_member_daemon_log_member_id" ON "member_daemon_log" USING btree ("membership_id","id" DESC);
