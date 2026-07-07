import type pg from "pg";

// ── Scope + visibility ──────────────────────────────────────────────────

export type InsightsScope =
  | { kind: "team-wide" }
  | { kind: "group"; groupId: string };

/** Members visible inside an insights scope. The team admin / staff view
 *  sees every non-revoked member of the team. Group managers see only the
 *  group's roster. The same predicate is used by every aggregation query
 *  so visibility lives in one place.
 *
 *  Returns membership IDs sorted for stable test snapshots. Empty array =
 *  no visible members; callers must guard before issuing follow-up queries
 *  (Postgres can't bind an empty array to `IN`). */
export async function visibleMembershipIds(
  teamId: string,
  scope: InsightsScope,
  pool: pg.Pool,
): Promise<string[]> {
  if (scope.kind === "group") {
    const res = await pool.query<{ id: string }>(
      `SELECT m.id
       FROM memberships m
       JOIN group_members gm ON gm.membership_id = m.id
       WHERE m.team_id = $1 AND m.revoked_at IS NULL AND gm.group_id = $2
       ORDER BY m.id`,
      [teamId, scope.groupId],
    );
    return res.rows.map((r) => r.id);
  }
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM memberships
     WHERE team_id = $1 AND revoked_at IS NULL ORDER BY id`,
    [teamId],
  );
  return res.rows.map((r) => r.id);
}

// ── Week-window helpers ─────────────────────────────────────────────────

export function isoMondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0=Sun, 1=Mon, …, 6=Sat. Shift so Monday=0.
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function previousIsoMonday(weekMonday: string): string {
  const d = new Date(`${weekMonday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function nextIsoMonday(weekMonday: string): string {
  const d = new Date(`${weekMonday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

// The most recent FULLY-ELAPSED ISO week (Mon–Sun). The current week is always
// in progress, so insight reports lead with this instead — a complete,
// stable window that also sidesteps the 1–2 day lag before the daemon has
// pushed the latest days.
export function lastCompletedWeekMonday(now: Date = new Date()): string {
  return previousIsoMonday(isoMondayOf(now));
}

// Validate a `?week=` param into a renderable week Monday: it must be a real
// Monday and no later than the last completed week (the current week is in
// progress and has no stable report). Anything else falls back to the last
// completed week, so a bad/blank param degrades gracefully.
export function resolveWeekMonday(param: string | null | undefined, now: Date = new Date()): string {
  const last = lastCompletedWeekMonday(now);
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return last;
  const d = new Date(`${param}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || isoMondayOf(d) !== param) return last;
  return param > last ? last : param;
}

// Monday of the earliest week with any data — the floor for week navigation.
// Considers member rollups AND synced integration history (GitHub merges,
// Linear completions), so older weeks stay browsable even where transcript
// submissions hadn't started yet. Pass `sources` to scope the integration
// floor to a group's mapped repos/Linear teams — null arrays mean team-wide.
// Null result when the scope has no data at all.
export async function earliestWeekMonday(
  teamId: string,
  membershipIds: string[],
  pool: pg.Pool,
  sources?: { repoNames: string[] | null; teamKeys: string[] | null; projectKeys?: string[] | null },
): Promise<string | null> {
  if (membershipIds.length === 0) return null;
  const repoNames = sources?.repoNames ?? null;
  const teamKeys = sources?.teamKeys ?? null;
  const projectKeys = sources?.projectKeys ?? null;
  const res = await pool.query<{ d: string | null }>(
    `SELECT min(d)::text AS d FROM (
       SELECT min(day)::date AS d FROM rich_daily_rollups WHERE membership_id = ANY($2::uuid[])
       UNION ALL
       -- daily_rollups is the superset (every push writes it; rich only when the
       -- member's perception entries existed at push time), so a backfill-only
       -- member's floor lives here, not in rich_daily_rollups.
       SELECT min(day)::date AS d FROM daily_rollups WHERE membership_id = ANY($2::uuid[])
       UNION ALL
       SELECT min(merged_at)::date FROM github_pull_requests
       WHERE team_id = $1 AND state = 'merged' AND ($3::text[] IS NULL OR repo = ANY($3::text[]))
       UNION ALL
       SELECT min(completed_at)::date FROM linear_issues
       WHERE team_id = $1 AND state_type = 'completed' AND ($4::text[] IS NULL OR linear_team_key = ANY($4::text[]))
       UNION ALL
       SELECT min(completed_at)::date FROM jira_issues
       WHERE team_id = $1 AND state_type = 'completed' AND ($5::text[] IS NULL OR jira_project_key = ANY($5::text[]))
     ) t WHERE d IS NOT NULL`,
    [teamId, membershipIds, repoNames, teamKeys, projectKeys],
  );
  const d = res.rows[0]?.d;
  return d ? isoMondayOf(new Date(`${d}T00:00:00Z`)) : null;
}

export function weekEndExclusive(weekMonday: string): string {
  const d = new Date(`${weekMonday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

// ── Block: Team pulse (this week vs last) ───────────────────────────────

export type TeamPulseBlockData = {
  weekMonday: string;
  membersActive: number;
  agentHours: number;
  agentHoursPrev: number;
  sessions: number;
  sessionsPrev: number;
  concurrencyPeak: number;
  parallelHours: number;
  prs: number;
  prsPrev: number;
};

/** One row per member per week. We sum across visible members in JS rather
 *  than in SQL so the function returns the same shape whether the scope is
 *  group or team-wide and adding more derived fields stays cheap. */
export async function teamPulseWeek(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
): Promise<TeamPulseBlockData> {
  const memberIds = await visibleMembershipIds(teamId, scope, pool);
  const empty: TeamPulseBlockData = {
    weekMonday,
    membersActive: 0,
    agentHours: 0,
    agentHoursPrev: 0,
    sessions: 0,
    sessionsPrev: 0,
    concurrencyPeak: 0,
    parallelHours: 0,
    prs: 0,
    prsPrev: 0,
  };
  if (memberIds.length === 0) return empty;

  const prevMonday = previousIsoMonday(weekMonday);
  const winEnd = weekEndExclusive(weekMonday);

  const res = await pool.query<{
    membership_id: string;
    day: string;
    agent_time_ms: string;
    sessions: number;
    concurrency_peak: number;
    parallel_minutes: number;
    prs: number;
  }>(
    // FULL OUTER JOIN of the base superset (daily_rollups, written by every push)
    // and rich_daily_rollups (only when perception entries existed at push time).
    // Base metrics COALESCE(d, r) preferring d; rich-only cols 0-default so a
    // backfill-only member still counts. Each side is filtered in its subquery —
    // moving the filters above the join would break outer semantics.
    `SELECT COALESCE(d.membership_id, r.membership_id) AS membership_id,
            COALESCE(d.day, r.day)::text AS day,
            COALESCE(d.agent_time_ms, r.agent_time_ms)::text AS agent_time_ms,
            COALESCE(d.sessions, r.sessions) AS sessions,
            COALESCE(r.concurrency_peak, 0) AS concurrency_peak,
            COALESCE(r.parallel_minutes, 0) AS parallel_minutes,
            COALESCE(r.prs, 0) AS prs
     FROM (SELECT membership_id, day, agent_time_ms,
                  COALESCE(unique_sessions, sessions) AS sessions
           FROM daily_rollups
           WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
             AND day >= $3::date AND day < $4::date) d
     FULL OUTER JOIN (SELECT membership_id, day, agent_time_ms,
                             COALESCE(unique_sessions, sessions) AS sessions,
                             concurrency_peak, parallel_minutes, prs
                      FROM rich_daily_rollups
                      WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
                        AND day >= $3::date AND day < $4::date) r
       ON r.membership_id = d.membership_id AND r.day = d.day`,
    [teamId, memberIds, prevMonday, winEnd],
  );

  const active = new Set<string>();
  let agentMs = 0, agentMsPrev = 0;
  let sessions = 0, sessionsPrev = 0;
  let concurrencyPeak = 0;
  let parallelMinutes = 0;
  let prs = 0, prsPrev = 0;
  for (const row of res.rows) {
    const isPrev = row.day < weekMonday;
    const ms = Number(row.agent_time_ms);
    if (isPrev) {
      agentMsPrev += ms;
      sessionsPrev += row.sessions;
      prsPrev += row.prs;
    } else {
      agentMs += ms;
      sessions += row.sessions;
      prs += row.prs;
      parallelMinutes += row.parallel_minutes;
      if (row.concurrency_peak > concurrencyPeak) concurrencyPeak = row.concurrency_peak;
      if (ms > 0 || row.sessions > 0) active.add(row.membership_id);
    }
  }

  return {
    weekMonday,
    membersActive: active.size,
    agentHours: agentMs / 3_600_000,
    agentHoursPrev: agentMsPrev / 3_600_000,
    sessions,
    sessionsPrev,
    concurrencyPeak,
    parallelHours: parallelMinutes / 60,
    prs,
    prsPrev,
  };
}

// ── Block: Per-project time, this week vs last ──────────────────────────

export type ProjectTimeRow = {
  project: string;
  agentHours: number;
  agentHoursPrev: number;
  sessions: number;
  // owner/name identities members reported for this project (git-push /
  // gh-pr output) — ground truth for repo canonicalization.
  githubRepos?: string[];
};

export async function perProjectTimeWoW(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
  opts: { limit?: number } = {},
): Promise<ProjectTimeRow[]> {
  const memberIds = await visibleMembershipIds(teamId, scope, pool);
  if (memberIds.length === 0) return [];

  const prevMonday = previousIsoMonday(weekMonday);
  const winEnd = weekEndExclusive(weekMonday);

  // jsonb_to_recordset unpacks the per-day projects array into rows we can
  // sum across. Each rich_daily_rollup row carries projects = [{project,
  // agentTimeMs, sessions, githubRepos?}, ...]. githubRepos stays in the
  // GROUP BY — a day-row's repo identity must never be unioned across
  // same-named rows from different repos (two "~/Repo" sessions attributed
  // to different remotes), or one repo's label swallows the other's hours.
  const res = await pool.query<{
    project: string;
    repos: string[] | null;
    agent_time_ms: string;
    sessions: number;
    is_prev: boolean;
  }>(
    `SELECT p.project,
            p."githubRepos" AS repos,
            SUM((p."agentTimeMs")::bigint)::text AS agent_time_ms,
            SUM((p.sessions)::int)::int AS sessions,
            (r.day < $3::date) AS is_prev
     FROM rich_daily_rollups r
     CROSS JOIN LATERAL jsonb_to_recordset(r.projects)
       AS p(project text, "agentTimeMs" bigint, sessions int, "githubRepos" jsonb)
     WHERE r.team_id = $1
       AND r.membership_id = ANY($2::uuid[])
       AND r.day >= $4::date
       AND r.day < $5::date
     GROUP BY p.project, p."githubRepos", is_prev`,
    [teamId, memberIds, weekMonday, prevMonday, winEnd],
  );

  // Key by the row's primary repo identity — the member's resolver puts the
  // .git-derived identity first — so same-repo rows merge across clone names
  // and weeks, while repo-less rows stay keyed by name.
  const byProject = new Map<string, ProjectTimeRow>();
  for (const row of res.rows) {
    const key = row.repos?.[0]?.toLowerCase() ?? row.project;
    const cur = byProject.get(key) ?? {
      project: row.project, agentHours: 0, agentHoursPrev: 0, sessions: 0,
      ...(row.repos?.length ? { githubRepos: row.repos } : {}),
    };
    const hrs = Number(row.agent_time_ms) / 3_600_000;
    if (row.is_prev) {
      cur.agentHoursPrev += hrs;
    } else {
      cur.agentHours += hrs;
      cur.sessions += row.sessions;
    }
    byProject.set(key, cur);
  }
  const rows = Array.from(byProject.values()).sort((a, b) => b.agentHours - a.agentHours);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

// ── Block: Skill usage this week (with previous-week count for WoW) ─────

export type SkillUsageRow = {
  skill: string;
  sessions: number;
  sessionsPrev: number;
};

export async function skillUsageWeek(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
  opts: { limit?: number } = {},
): Promise<SkillUsageRow[]> {
  const memberIds = await visibleMembershipIds(teamId, scope, pool);
  if (memberIds.length === 0) return [];

  const prevMonday = previousIsoMonday(weekMonday);
  const winEnd = weekEndExclusive(weekMonday);

  const res = await pool.query<{
    skill: string;
    sessions: number;
    is_prev: boolean;
  }>(
    `SELECT s.name AS skill,
            SUM((s.sessions)::int)::int AS sessions,
            (r.day < $3::date) AS is_prev
     FROM rich_daily_rollups r
     CROSS JOIN LATERAL jsonb_to_recordset(r.skills_loaded)
       AS s(name text, sessions int)
     WHERE r.team_id = $1
       AND r.membership_id = ANY($2::uuid[])
       AND r.day >= $4::date
       AND r.day < $5::date
     GROUP BY s.name, is_prev`,
    [teamId, memberIds, weekMonday, prevMonday, winEnd],
  );

  const bySkill = new Map<string, SkillUsageRow>();
  for (const row of res.rows) {
    const cur = bySkill.get(row.skill) ?? { skill: row.skill, sessions: 0, sessionsPrev: 0 };
    if (row.is_prev) cur.sessionsPrev += row.sessions;
    else cur.sessions += row.sessions;
    bySkill.set(row.skill, cur);
  }
  const rows = Array.from(bySkill.values())
    .sort((a, b) => b.sessions + b.sessionsPrev - a.sessions - a.sessionsPrev);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

// ── Block: Working-shape distribution this week ─────────────────────────

export type WorkingShapeRow = {
  shape: string;
  sessions: number;
  agentHours: number;
};

export async function workingShapeDistribution(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
): Promise<WorkingShapeRow[]> {
  const memberIds = await visibleMembershipIds(teamId, scope, pool);
  if (memberIds.length === 0) return [];

  const winEnd = weekEndExclusive(weekMonday);

  const res = await pool.query<{
    shape: string;
    sessions: number;
    agent_time_ms: string;
  }>(
    `SELECT s.shape,
            SUM((s.sessions)::int)::int AS sessions,
            SUM((s."agentTimeMs")::bigint)::text AS agent_time_ms
     FROM rich_daily_rollups r
     CROSS JOIN LATERAL jsonb_to_recordset(r.working_shapes)
       AS s(shape text, sessions int, "agentTimeMs" bigint)
     WHERE r.team_id = $1
       AND r.membership_id = ANY($2::uuid[])
       AND r.day >= $3::date
       AND r.day < $4::date
     GROUP BY s.shape`,
    [teamId, memberIds, weekMonday, winEnd],
  );

  return res.rows
    .map((row) => ({
      shape: row.shape,
      sessions: row.sessions,
      agentHours: Number(row.agent_time_ms) / 3_600_000,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

export type MomentumTrendWeek = {
  weekMonday: string;
  agentHours: number;
  sessions: number;
  prs: number;
  activeMembers: number;
};

// Trailing N-week trajectory for a scope. Small groups read noisy week-over-week,
// so the group dashboard leads with this 4-week trend instead of raw WoW deltas.
// Returns one entry per expected week, oldest→newest, zero-filling empty weeks.
export async function groupMomentumTrend(
  teamId: string,
  scope: InsightsScope,
  weekMonday: string,
  pool: pg.Pool,
  weeks = 4,
): Promise<MomentumTrendWeek[]> {
  const mondays: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(`${weekMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i * 7);
    mondays.push(d.toISOString().slice(0, 10));
  }
  const empty = (m: string): MomentumTrendWeek => ({
    weekMonday: m, agentHours: 0, sessions: 0, prs: 0, activeMembers: 0,
  });

  const memberIds = await visibleMembershipIds(teamId, scope, pool);
  if (memberIds.length === 0) return mondays.map(empty);

  const res = await pool.query<{
    week_monday: string; agent_ms: string; sessions: number; prs: number; active_members: number;
  }>(
    // date_trunc('week') is ISO (Monday-anchored), so the bucket key matches our
    // weekMonday strings directly. FULL OUTER JOIN so backfill-only members (rows
    // in daily_rollups but not rich_daily_rollups) count toward agent time /
    // sessions / active members; prs stays rich-only (0 for daily-only rows).
    `SELECT date_trunc('week', COALESCE(d.day, r.day))::date::text AS week_monday,
            COALESCE(SUM(COALESCE(d.agent_time_ms, r.agent_time_ms)), 0)::text AS agent_ms,
            COALESCE(SUM(COALESCE(d.sessions, r.sessions)), 0)::int AS sessions,
            COALESCE(SUM(COALESCE(r.prs, 0)), 0)::int AS prs,
            COUNT(DISTINCT COALESCE(d.membership_id, r.membership_id))
              FILTER (WHERE COALESCE(d.agent_time_ms, r.agent_time_ms) > 0)::int AS active_members
     FROM (SELECT membership_id, day, agent_time_ms,
                  COALESCE(unique_sessions, sessions) AS sessions
           FROM daily_rollups
           WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
             AND day >= $3::date AND day < $4::date) d
     FULL OUTER JOIN (SELECT membership_id, day, agent_time_ms,
                             COALESCE(unique_sessions, sessions) AS sessions, prs
                      FROM rich_daily_rollups
                      WHERE team_id = $1 AND membership_id = ANY($2::uuid[])
                        AND day >= $3::date AND day < $4::date) r
       ON r.membership_id = d.membership_id AND r.day = d.day
     GROUP BY 1`,
    [teamId, memberIds, mondays[0], weekEndExclusive(weekMonday)],
  );
  const byWeek = new Map<string, MomentumTrendWeek>();
  for (const r of res.rows) {
    byWeek.set(r.week_monday, {
      weekMonday: r.week_monday,
      agentHours: Number(r.agent_ms) / 3_600_000,
      sessions: r.sessions,
      prs: r.prs,
      activeMembers: r.active_members,
    });
  }
  return mondays.map((m) => byWeek.get(m) ?? empty(m));
}
