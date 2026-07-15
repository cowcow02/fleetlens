-- description: contract step for 0015 — drop the legacy team_integrations table (rows copied to integrations in server-v0.15.0)
-- Hand-authored orphan migration (same pattern as 0009-0015): the migrate
-- runner's fallback applier picks up .sql files not in _journal.json.
-- Contract half of the 0015 expand/contract pair: every container since
-- 0.15.0 reads and writes only `integrations`; nothing touches this table.
DROP TABLE IF EXISTS "team_integrations";
