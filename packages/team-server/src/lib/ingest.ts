import pg from "pg";
import { getPool } from "../db/pool.js";
import { IngestPayload } from "./zod-schemas.js";

export async function processIngest(
  raw: unknown,
  memberId: string,
  teamId: string,
  pool?: pg.Pool
) {
  const p = pool || getPool();
  const payload = IngestPayload.parse(raw);

  const existing = await p.query("SELECT 1 FROM ingest_log WHERE ingest_id = $1", [payload.ingestId]);
  if (existing.rowCount && existing.rowCount > 0) return { accepted: true, deduplicated: true };

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO ingest_log (ingest_id, team_id, member_id) VALUES ($1, $2, $3)",
      [payload.ingestId, teamId, memberId]
    );

    const r = payload.dailyRollup;
    await client.query(`
      INSERT INTO daily_rollups (team_id, member_id, day, agent_time_ms, sessions, tool_calls, turns,
                                 tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (team_id, member_id, day) DO UPDATE SET
        agent_time_ms = EXCLUDED.agent_time_ms,
        sessions = EXCLUDED.sessions,
        tool_calls = EXCLUDED.tool_calls,
        turns = EXCLUDED.turns,
        tokens_input = EXCLUDED.tokens_input,
        tokens_output = EXCLUDED.tokens_output,
        tokens_cache_read = EXCLUDED.tokens_cache_read,
        tokens_cache_write = EXCLUDED.tokens_cache_write
    `, [teamId, memberId, r.day, r.agentTimeMs, r.sessions, r.toolCalls, r.turns,
        r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite]);

    await client.query("UPDATE members SET last_seen_at = now() WHERE id = $1", [memberId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { accepted: true, nextSyncAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
}
