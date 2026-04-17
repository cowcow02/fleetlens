import type pg from "pg";

export type RosterRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  joined_at: string;
  last_seen_at: string | null;
  week_agent_time_ms: string;
  week_sessions: number;
  week_tool_calls: number;
  week_turns: number;
  week_tokens: string;
};

export type MemberRow = {
  id: string;
  team_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  joined_at: string;
  last_seen_at: string | null;
};

export type RollupRow = {
  day: string;
  agent_time_ms: string;
  sessions: number;
  tool_calls: number;
  turns: number;
  tokens_input: string;
  tokens_output: string;
  tokens_cache_read: string;
  tokens_cache_write: string;
};

export function weekStartIso(now = new Date()): string {
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

export async function loadRoster(teamId: string, pool: pg.Pool): Promise<RosterRow[]> {
  const res = await pool.query(`
    SELECT
      m.id, m.email, m.display_name, m.role, m.joined_at, m.last_seen_at,
      COALESCE(SUM(r.agent_time_ms), 0)::bigint AS week_agent_time_ms,
      COALESCE(SUM(r.sessions), 0)::int AS week_sessions,
      COALESCE(SUM(r.tool_calls), 0)::int AS week_tool_calls,
      COALESCE(SUM(r.turns), 0)::int AS week_turns,
      COALESCE(SUM(r.tokens_input + r.tokens_output), 0)::bigint AS week_tokens
    FROM members m
    LEFT JOIN daily_rollups r ON r.member_id = m.id AND r.team_id = m.team_id AND r.day >= $2
    WHERE m.team_id = $1 AND m.revoked_at IS NULL
    GROUP BY m.id
    ORDER BY m.last_seen_at DESC NULLS LAST
  `, [teamId, weekStartIso()]);
  return res.rows;
}

export async function loadMemberRollups(
  teamId: string,
  memberId: string,
  days: number,
  pool: pg.Pool,
): Promise<RollupRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await pool.query(`
    SELECT day::text, agent_time_ms, sessions, tool_calls, turns,
           tokens_input, tokens_output, tokens_cache_read, tokens_cache_write
    FROM daily_rollups
    WHERE team_id = $1 AND member_id = $2 AND day >= $3
    ORDER BY day ASC
  `, [teamId, memberId, since]);
  return res.rows;
}

export async function loadMember(memberId: string, pool: pg.Pool): Promise<MemberRow | null> {
  const res = await pool.query(
    "SELECT id, team_id, email, display_name, role, joined_at, last_seen_at FROM members WHERE id = $1",
    [memberId]
  );
  return res.rowCount ? res.rows[0] : null;
}
