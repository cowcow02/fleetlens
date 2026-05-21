import type pg from "pg";

export type RangeKey = "7d" | "30d" | "90d";

export const RANGE_DAYS: Record<RangeKey, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function parseRange(value: string | string[] | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "7d" || v === "30d" || v === "90d") return v;
  return "7d";
}

export type RosterRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  joined_at: string;
  last_seen_at: string | null;
  range_agent_time_ms: string;
  range_sessions: number;
  range_tool_calls: number;
  range_turns: number;
  range_tokens: string;
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

// Matches apps/web/lib/date-range.ts cutoffMs(): "last N local calendar days"
// = today + (N-1) prior days. Rolling, not calendar-bounded — keeps the team
// dashboard's 7d total comparable to the local dashboard's 7d total.
export function rangeStartIso(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

export async function loadRoster(teamId: string, days: number, pool: pg.Pool): Promise<RosterRow[]> {
  const res = await pool.query(`
    SELECT
      m.id, u.email, u.display_name, m.role, m.joined_at, m.last_seen_at,
      COALESCE(SUM(r.agent_time_ms), 0)::bigint AS range_agent_time_ms,
      COALESCE(SUM(r.sessions), 0)::int AS range_sessions,
      COALESCE(SUM(r.tool_calls), 0)::int AS range_tool_calls,
      COALESCE(SUM(r.turns), 0)::int AS range_turns,
      COALESCE(SUM(r.tokens_input + r.tokens_output + r.tokens_cache_read + r.tokens_cache_write), 0)::bigint AS range_tokens
    FROM memberships m
    JOIN user_accounts u ON u.id = m.user_account_id
    LEFT JOIN daily_rollups r ON r.membership_id = m.id AND r.team_id = m.team_id AND r.day >= $2
    WHERE m.team_id = $1 AND m.revoked_at IS NULL
    GROUP BY m.id, u.email, u.display_name
    ORDER BY m.last_seen_at DESC NULLS LAST
  `, [teamId, rangeStartIso(days)]);
  return res.rows;
}

export async function loadMemberRollups(
  teamId: string,
  membershipId: string,
  days: number,
  pool: pg.Pool,
): Promise<RollupRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await pool.query(`
    SELECT day::text, agent_time_ms, sessions, tool_calls, turns,
           tokens_input, tokens_output, tokens_cache_read, tokens_cache_write
    FROM daily_rollups
    WHERE team_id = $1 AND membership_id = $2 AND day >= $3
    ORDER BY day ASC
  `, [teamId, membershipId, since]);
  return res.rows;
}

export async function loadMember(membershipId: string, pool: pg.Pool): Promise<MemberRow | null> {
  const res = await pool.query(
    `SELECT m.id, m.team_id, u.email, u.display_name, m.role, m.joined_at, m.last_seen_at
     FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.id = $1`,
    [membershipId]
  );
  return res.rowCount ? res.rows[0] : null;
}

export type GroupRosterRow = RosterRow & { is_manager: boolean };

export async function loadGroupRoster(groupId: string, days: number, pool: pg.Pool): Promise<GroupRosterRow[]> {
  const res = await pool.query<GroupRosterRow>(`
    SELECT
      m.id, u.email, u.display_name, m.role, m.joined_at, m.last_seen_at,
      gm.is_manager,
      COALESCE(SUM(r.agent_time_ms), 0)::bigint AS range_agent_time_ms,
      COALESCE(SUM(r.sessions), 0)::int AS range_sessions,
      COALESCE(SUM(r.tool_calls), 0)::int AS range_tool_calls,
      COALESCE(SUM(r.turns), 0)::int AS range_turns,
      COALESCE(SUM(r.tokens_input + r.tokens_output + r.tokens_cache_read + r.tokens_cache_write), 0)::bigint AS range_tokens
    FROM group_members gm
    JOIN memberships m ON m.id = gm.membership_id
    JOIN user_accounts u ON u.id = m.user_account_id
    LEFT JOIN daily_rollups r ON r.membership_id = m.id AND r.team_id = m.team_id AND r.day >= $2
    WHERE gm.group_id = $1 AND m.revoked_at IS NULL
    GROUP BY m.id, u.email, u.display_name, gm.is_manager
    ORDER BY gm.is_manager DESC, m.last_seen_at DESC NULLS LAST
  `, [groupId, rangeStartIso(days)]);
  return res.rows;
}

export type GroupAffiliation = {
  groupId: string;
  slug: string;
  name: string;
  isManager: boolean;
};

export async function loadMemberGroupAffiliations(
  teamId: string,
  pool: pg.Pool,
): Promise<Map<string, GroupAffiliation[]>> {
  const res = await pool.query<{ membership_id: string; group_id: string; slug: string; name: string; is_manager: boolean }>(`
    SELECT gm.membership_id, g.id AS group_id, g.slug, g.name, gm.is_manager
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
    WHERE g.team_id = $1
    ORDER BY g.name
  `, [teamId]);
  const map = new Map<string, GroupAffiliation[]>();
  for (const row of res.rows) {
    if (!map.has(row.membership_id)) map.set(row.membership_id, []);
    map.get(row.membership_id)!.push({
      groupId: row.group_id,
      slug: row.slug,
      name: row.name,
      isManager: row.is_manager,
    });
  }
  return map;
}
