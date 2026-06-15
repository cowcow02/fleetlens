-- description: add unique_sessions (start-day session count) alongside session-days

-- `sessions` became session-days (a cross-midnight session counts on every day
-- it touched) so per-day rollups stop showing "agent time but 0 sessions".
-- `unique_sessions` keeps the start-day count so SUM over a range still equals
-- the real unique-session total. Nullable: rows pushed by older CLIs have no
-- value, and consumers COALESCE(unique_sessions, sessions). Expand-safe.
ALTER TABLE daily_rollups ADD COLUMN IF NOT EXISTS unique_sessions integer;
ALTER TABLE rich_daily_rollups ADD COLUMN IF NOT EXISTS unique_sessions integer;
