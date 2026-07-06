import type pg from "pg";
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  recommend,
  type MemberStats,
  type OptimizerSettings,
  type Recommendation,
} from "./plan-optimizer";
import type { MemberLatestSnapshot } from "./capacity-burndown";
import { tierEntry, type PlanTierKey } from "./plan-tiers";

export type OptimizerMemberInput = {
  membershipId: string;
  memberName: string;
  memberEmail: string | null;
  tierKey: PlanTierKey;
  stats: MemberStats;
};

const OPTIMIZER_LOOKBACK_DAYS = 30;
const BURNDOWN_LATEST_WINDOW_HOURS = 1;

export async function loadOptimizerInputs(
  teamId: string,
  pool: pg.Pool,
): Promise<OptimizerMemberInput[]> {
  const res = await pool.query(`
    WITH agg AS (
      SELECT
        membership_id,
        MAX(peak_seven_day_pct)::float8     AS worst_7day_peak,
        AVG(avg_seven_day_pct)::float8      AS avg_7day_avg,
        MAX(peak_five_hour_pct)::float8     AS worst_5hr_peak,
        MAX(peak_opus_pct)::float8          AS worst_opus_peak,
        SUM(distinct_days_observed)::int    AS total_days_observed,
        EXTRACT(EPOCH FROM MAX(last_captured_at))::float8 * 1000 AS last_seen_ms
      FROM membership_weekly_utilization
      WHERE team_id = $1
        -- Anchor the lookback on window_start_day so a cycle that opened
        -- before the 30-day horizon doesn't leak its 7-day span into the
        -- aggregate. Mirrors the 12-week trailing query below that already
        -- uses window_start_day for the same reason.
        AND window_start_day >= now() - make_interval(days => $2::int)
      GROUP BY membership_id
    )
    SELECT
      m.id                       AS membership_id,
      COALESCE(u.display_name, u.email) AS member_name,
      u.email                    AS member_email,
      m.plan_tier                AS tier_key,
      COALESCE(a.worst_7day_peak, 0)     AS worst_7day_peak,
      COALESCE(a.avg_7day_avg, 0)        AS avg_7day_avg,
      COALESCE(a.worst_5hr_peak, 0)      AS worst_5hr_peak,
      COALESCE(a.worst_opus_peak, 0)     AS worst_opus_peak,
      COALESCE(a.total_days_observed, 0) AS total_days_observed,
      a.last_seen_ms             AS last_seen_ms
    FROM memberships m
    JOIN user_accounts u ON u.id = m.user_account_id
    LEFT JOIN agg a ON a.membership_id = m.id
    WHERE m.team_id = $1 AND m.revoked_at IS NULL
    ORDER BY m.joined_at ASC
  `, [teamId, OPTIMIZER_LOOKBACK_DAYS]);

  return res.rows.map((r) => ({
    membershipId: r.membership_id,
    memberName: r.member_name ?? "(unnamed)",
    memberEmail: r.member_email,
    tierKey: r.tier_key as PlanTierKey,
    stats: {
      worstSevenDayPeak: Number(r.worst_7day_peak),
      avgSevenDayAvg: Number(r.avg_7day_avg),
      worstFiveHourPeak: Number(r.worst_5hr_peak),
      worstOpusPeak: Number(r.worst_opus_peak),
      totalDaysObserved: Number(r.total_days_observed),
      lastSeenAtMs: r.last_seen_ms == null ? null : Number(r.last_seen_ms),
    },
  }));
}

export async function loadLatestSnapshotsPerMember(
  teamId: string,
  pool: pg.Pool,
): Promise<MemberLatestSnapshot[]> {
  const res = await pool.query(`
    SELECT DISTINCT ON (pu.membership_id)
      pu.membership_id,
      COALESCE(u.display_name, u.email) AS member_name,
      m.plan_tier AS tier_key,
      pu.seven_day_utilization,
      pu.seven_day_resets_at,
      pu.captured_at
    FROM plan_utilization pu
    JOIN memberships m ON m.id = pu.membership_id
    JOIN user_accounts u ON u.id = m.user_account_id
    WHERE pu.team_id = $1
      AND pu.captured_at > now() - make_interval(hours => $2::int)
      AND m.revoked_at IS NULL
    ORDER BY pu.membership_id, pu.captured_at DESC
  `, [teamId, BURNDOWN_LATEST_WINDOW_HOURS]);

  return res.rows.map((r) => ({
    membershipId: r.membership_id,
    memberName: r.member_name ?? "(unnamed)",
    tierKey: r.tier_key as PlanTierKey,
    sevenDayUtilization:
      r.seven_day_utilization == null ? null : Number(r.seven_day_utilization),
    sevenDayResetsAt: r.seven_day_resets_at ? new Date(r.seven_day_resets_at) : null,
    capturedAt: new Date(r.captured_at),
  }));
}

export async function loadMembershipSparklines(
  teamId: string,
  pool: pg.Pool,
  weeks = 12,
): Promise<Map<string, number[]>> {
  const res = await pool.query<{
    membership_id: string;
    window_start_day: string;
    peak_seven_day_pct: number;
  }>(
    `SELECT membership_id, window_start_day::text, peak_seven_day_pct
     FROM membership_weekly_utilization
     WHERE team_id = $1
       AND window_start_day >= now() - make_interval(weeks => $2::int)
     ORDER BY membership_id, window_start_day ASC`,
    [teamId, weeks],
  );
  const out = new Map<string, number[]>();
  for (const r of res.rows) {
    const arr = out.get(r.membership_id) ?? [];
    arr.push(Number(r.peak_seven_day_pct ?? 0));
    out.set(r.membership_id, arr);
  }
  return out;
}

export type MembershipCyclePeak = {
  endsAt: Date;
  peakPct: number;
  source: "real" | "predicted";
  isCurrent: boolean;
};

// Per-member 7d cycle history. Source data comes straight from the daemon's
// computed cyclePeaks payload — single source of truth shared with the
// personal /usage trend strip. Server doesn't re-derive.
export async function loadMembership7dCyclePeaks(
  teamId: string,
  pool: pg.Pool,
  maxCyclesPerMember = 12,
): Promise<Map<string, MembershipCyclePeak[]>> {
  const res = await pool.query<{
    membership_id: string;
    ends_at: string;
    peak_pct: number;
    source: string;
    is_current: boolean;
  }>(
    // "window" is a reserved keyword in some Postgres parser contexts
    // (it's an OLAP window-function clause), so always quote the column.
    `SELECT membership_id, ends_at, peak_pct, source, is_current
     FROM membership_cycle_peaks
     WHERE team_id = $1 AND "window" = '7d'
     ORDER BY membership_id, ends_at DESC`,
    [teamId],
  );
  const out = new Map<string, MembershipCyclePeak[]>();
  for (const r of res.rows) {
    const arr = out.get(r.membership_id) ?? [];
    if (arr.length >= maxCyclesPerMember) continue;
    arr.push({
      endsAt: new Date(r.ends_at),
      peakPct: Number(r.peak_pct),
      source: r.source === "real" ? "real" : "predicted",
      isCurrent: r.is_current,
    });
    out.set(r.membership_id, arr);
  }
  // Order each member's array oldest → newest so the bar chart reads
  // chronologically left-to-right.
  for (const [k, v] of out) out.set(k, v.slice().reverse());
  return out;
}

export async function loadTeam7dCurrentCycles(
  teamId: string,
  pool: pg.Pool,
): Promise<Map<string, CurrentCycleData>> {
  const res = await pool.query<{
    membership_id: string;
    captured_at: string;
    seven_day_utilization: number;
    seven_day_resets_at: string;
    latest_resets_at: string;
  }>(
    `WITH latest_reset AS (
      SELECT DISTINCT ON (membership_id)
        membership_id,
        seven_day_resets_at AS resets_at,
        date_trunc('hour', seven_day_resets_at + interval '30 minutes') AS resets_at_hour
      FROM plan_utilization
      WHERE team_id = $1 AND seven_day_resets_at IS NOT NULL
      ORDER BY membership_id, captured_at DESC
    )
    SELECT
      pu.membership_id,
      pu.captured_at,
      pu.seven_day_utilization,
      pu.seven_day_resets_at,
      lr.resets_at AS latest_resets_at
    FROM plan_utilization pu
    JOIN latest_reset lr ON lr.membership_id = pu.membership_id
      AND date_trunc('hour', pu.seven_day_resets_at + interval '30 minutes') = lr.resets_at_hour
    WHERE pu.team_id = $1
      AND pu.seven_day_utilization IS NOT NULL
      AND pu.seven_day_resets_at IS NOT NULL
    ORDER BY pu.membership_id, pu.captured_at ASC`,
    [teamId],
  );

  const out = new Map<string, CurrentCycleData>();
  for (const r of res.rows) {
    const endMs = Date.parse(r.latest_resets_at);
    const startMs = endMs - 7 * 86_400_000;
    const capturedAt = new Date(r.captured_at);
    const capturedMs = capturedAt.getTime();
    if (capturedMs < startMs) continue;

    let cycle = out.get(r.membership_id);
    if (!cycle) {
      cycle = { startMs, endMs, snapshots: [] };
      out.set(r.membership_id, cycle);
    }
    cycle.snapshots.push({
      capturedAt,
      utilization: Number(r.seven_day_utilization),
    });
  }
  return out;
}


export type CurrentCycleSnapshot = {
  capturedAt: Date;
  utilization: number;  // 0..100
};

export type CurrentCycleData = {
  startMs: number;
  endMs: number;
  snapshots: CurrentCycleSnapshot[];
};

// Per-snapshot 7d utilization for the IN-PROGRESS cycle of one member,
// used to draw a sprint-style burndown. Bounds = the cycle whose
// resets_at matches the latest snapshot. Snapshots earlier than that
// (= previous cycle's tail) are excluded so the chart shows ONE clean
// burndown trace, never a sawtooth.
export async function loadMember7dCurrentCycle(
  teamId: string,
  membershipId: string,
  pool: pg.Pool,
): Promise<CurrentCycleData | null> {
  const latest = await pool.query<{ resets_at: string }>(
    `SELECT seven_day_resets_at AS resets_at
     FROM plan_utilization
     WHERE team_id = $1 AND membership_id = $2 AND seven_day_resets_at IS NOT NULL
     ORDER BY captured_at DESC
     LIMIT 1`,
    [teamId, membershipId],
  );
  if (latest.rowCount === 0) return null;
  const resetIso = latest.rows[0]!.resets_at;
  const endMs = Date.parse(resetIso);
  const startMs = endMs - 7 * 86_400_000;

  // Fetch snapshots that share the same resets_at (exact ISO match).
  // Anthropic's microsecond jitter on resets_at means same-cycle rows
  // can vary by ±100ms across snapshots — round to the nearest hour to
  // group all of them.
  const HOUR = 3_600_000;
  const bucketMs = Math.round(endMs / HOUR) * HOUR;
  const rows = await pool.query<{
    captured_at: string;
    seven_day_utilization: number;
    seven_day_resets_at: string;
  }>(
    `SELECT captured_at, seven_day_utilization, seven_day_resets_at
     FROM plan_utilization
     WHERE team_id = $1 AND membership_id = $2
       AND seven_day_utilization IS NOT NULL
       AND seven_day_resets_at IS NOT NULL
       AND captured_at >= $3
     ORDER BY captured_at ASC`,
    [teamId, membershipId, new Date(startMs).toISOString()],
  );

  const snapshots: CurrentCycleSnapshot[] = [];
  for (const r of rows.rows) {
    const rowResetMs = Math.round(Date.parse(r.seven_day_resets_at) / HOUR) * HOUR;
    if (rowResetMs !== bucketMs) continue;  // different cycle
    snapshots.push({
      capturedAt: new Date(r.captured_at),
      utilization: Number(r.seven_day_utilization),
    });
  }
  return { startMs, endMs, snapshots };
}

export async function loadMembersWithTier(
  teamId: string,
  pool: pg.Pool,
): Promise<Array<{
  id: string;
  email: string | null;
  display_name: string | null;
  plan_tier: string;
  revoked_at: string | null;
  joined_at: string;
}>> {
  const res = await pool.query(
    `SELECT m.id, u.email, u.display_name, m.plan_tier, m.revoked_at, m.joined_at
     FROM memberships m
     JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1
     ORDER BY m.joined_at`,
    [teamId],
  );
  return res.rows;
}

export type MemberPlanSummary = {
  planTier: string;
  avgSevenDayPct: number;
  worstSevenDayPeak: number;
  worstFiveHourPeak: number;
  worstOpusPeak: number;
  totalDaysObserved: number;
  // Recency of the last USAGE snapshot (drives utilization-data staleness).
  lastSeenAtMs: number | null;
  // True daemon heartbeat: memberships.last_seen_at, updated on EVERY non-dedup
  // push (metrics OR usage). This is LIVENESS ("is the daemon talking?"), not
  // sync health — a push can land here and still drop blocks. Health lives in
  // the server ingest log. Drives the DAEMON badge so it stops reading
  // "stalled" for a member who syncs metrics but sends no usage snapshot.
  daemonLastSeenAtMs: number | null;
  trail: number[];
  // Number of distinct local days in the last 30 where the daemon observed
  // utilization at or above 100% — i.e., this member ran into the wall.
  wallHits5h: number;
  wallHits7d: number;
  recommendation: Recommendation;
};

export async function loadMemberPlanSummary(
  teamId: string,
  membershipId: string,
  pool: pg.Pool,
): Promise<MemberPlanSummary> {
  const [tierRes, statsRes, trailRes, wallsRes, settings] = await Promise.all([
    pool.query<{ plan_tier: string; daemon_last_seen_ms: number | null }>(
      `SELECT plan_tier,
              EXTRACT(EPOCH FROM last_seen_at)::float8 * 1000 AS daemon_last_seen_ms
       FROM memberships WHERE id = $1 AND team_id = $2`,
      [membershipId, teamId],
    ),
    pool.query<{
      worst_7day_peak: number | null;
      avg_7day_avg: number | null;
      worst_5hr_peak: number | null;
      worst_opus_peak: number | null;
      total_days_observed: number | null;
      last_seen_ms: number | null;
    }>(
      `SELECT
         MAX(peak_seven_day_pct)::float8     AS worst_7day_peak,
         AVG(avg_seven_day_pct)::float8      AS avg_7day_avg,
         MAX(peak_five_hour_pct)::float8     AS worst_5hr_peak,
         MAX(peak_opus_pct)::float8          AS worst_opus_peak,
         SUM(distinct_days_observed)::int    AS total_days_observed,
         EXTRACT(EPOCH FROM MAX(last_captured_at))::float8 * 1000 AS last_seen_ms
       FROM membership_weekly_utilization
       WHERE team_id = $1 AND membership_id = $2
         AND window_start_day >= now() - interval '30 days'`,
      [teamId, membershipId],
    ),
    pool.query<{ peak_seven_day_pct: number }>(
      `SELECT peak_seven_day_pct
       FROM membership_weekly_utilization
       WHERE team_id = $1 AND membership_id = $2
         AND window_start_day >= now() - interval '12 weeks'
       ORDER BY window_start_day ASC`,
      [teamId, membershipId],
    ),
    // Read raw plan_utilization (not the mat view) so wall-hits surface the
    // moment a snapshot lands, without waiting for the hourly mat view tick.
    pool.query<{ wall_hits_5h: number; wall_hits_7d: number }>(
      `SELECT
         COUNT(DISTINCT date_trunc('day', captured_at))
           FILTER (WHERE five_hour_utilization >= 100)::int AS wall_hits_5h,
         COUNT(DISTINCT date_trunc('day', captured_at))
           FILTER (WHERE seven_day_utilization >= 100)::int AS wall_hits_7d
       FROM plan_utilization
       WHERE team_id = $1 AND membership_id = $2
         AND captured_at >= now() - interval '30 days'`,
      [teamId, membershipId],
    ),
    loadOptimizerSettings(teamId, pool),
  ]);

  const stats = statsRes.rows[0] ?? {
    worst_7day_peak: null,
    avg_7day_avg: null,
    worst_5hr_peak: null,
    worst_opus_peak: null,
    total_days_observed: null,
    last_seen_ms: null,
  };
  const walls = wallsRes.rows[0] ?? { wall_hits_5h: 0, wall_hits_7d: 0 };

  const planTier = tierRes.rows[0]?.plan_tier ?? "pro-max";
  const memberStats: MemberStats = {
    worstSevenDayPeak: Number(stats.worst_7day_peak ?? 0),
    avgSevenDayAvg: Number(stats.avg_7day_avg ?? 0),
    worstFiveHourPeak: Number(stats.worst_5hr_peak ?? 0),
    worstOpusPeak: Number(stats.worst_opus_peak ?? 0),
    totalDaysObserved: Number(stats.total_days_observed ?? 0),
    lastSeenAtMs: stats.last_seen_ms == null ? null : Number(stats.last_seen_ms),
  };

  return {
    planTier,
    avgSevenDayPct: memberStats.avgSevenDayAvg,
    worstSevenDayPeak: memberStats.worstSevenDayPeak,
    worstFiveHourPeak: memberStats.worstFiveHourPeak,
    worstOpusPeak: memberStats.worstOpusPeak,
    totalDaysObserved: memberStats.totalDaysObserved,
    lastSeenAtMs: memberStats.lastSeenAtMs,
    daemonLastSeenAtMs:
      tierRes.rows[0]?.daemon_last_seen_ms == null
        ? null
        : Number(tierRes.rows[0].daemon_last_seen_ms),
    trail: trailRes.rows.map((r) => Number(r.peak_seven_day_pct ?? 0)),
    wallHits5h: Number(walls.wall_hits_5h ?? 0),
    wallHits7d: Number(walls.wall_hits_7d ?? 0),
    recommendation: recommend(memberStats, tierEntry(planTier), settings),
  };
}

export type MemberSyncLogRow = {
  id: number;
  ingestId: string;
  cliVersion: string | null;
  accepted: string[];
  skipped: Record<string, string>;
  status: "ok" | "partial";
  dedup: boolean;
  histInserted: number;
  histReceived: number;
  createdAtMs: number;
};

// Recent per-push sync events for one member, newest first. Backs the in-UI
// "View logs" panel so admins can see sync health without container stdout.
export async function loadMemberSyncLog(
  teamId: string,
  membershipId: string,
  pool: pg.Pool,
  limit = 100,
): Promise<MemberSyncLogRow[]> {
  const res = await pool.query<{
    id: string;
    ingest_id: string;
    cli_version: string | null;
    accepted: unknown;
    skipped: unknown;
    status: string;
    dedup: boolean;
    hist_inserted: number;
    hist_received: number;
    created_ms: number;
  }>(
    `SELECT id, ingest_id, cli_version, accepted, skipped, status, dedup,
            hist_inserted, hist_received,
            EXTRACT(EPOCH FROM created_at)::float8 * 1000 AS created_ms
       FROM member_sync_log
       WHERE team_id = $1 AND membership_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
    [teamId, membershipId, limit],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    ingestId: r.ingest_id,
    cliVersion: r.cli_version,
    accepted: Array.isArray(r.accepted) ? (r.accepted as string[]) : [],
    skipped: (r.skipped && typeof r.skipped === "object" ? r.skipped : {}) as Record<string, string>,
    status: r.status === "partial" ? "partial" : "ok",
    dedup: r.dedup,
    histInserted: Number(r.hist_inserted),
    histReceived: Number(r.hist_received),
    createdAtMs: Number(r.created_ms),
  }));
}

export type MemberDaemonLogRow = { tsMs: number; level: string; msg: string };

// The member's own daemon sync log (uploaded from their machine), newest
// first. This is the primary per-member troubleshooting artifact — the
// client-side story of each sync, not the server's view of what arrived.
export async function loadMemberDaemonLog(
  teamId: string,
  membershipId: string,
  pool: pg.Pool,
  limit = 500,
): Promise<MemberDaemonLogRow[]> {
  const res = await pool.query<{ ts_ms: number; level: string; msg: string }>(
    `SELECT EXTRACT(EPOCH FROM ts)::float8 * 1000 AS ts_ms, level, msg
       FROM member_daemon_log
       WHERE team_id = $1 AND membership_id = $2
       ORDER BY ts DESC
       LIMIT $3`,
    [teamId, membershipId, limit],
  );
  return res.rows.map((r) => ({ tsMs: Number(r.ts_ms), level: r.level, msg: r.msg }));
}

export async function loadOptimizerSettings(
  teamId: string,
  pool: pg.Pool,
): Promise<OptimizerSettings> {
  const res = await pool.query<{ settings: { planOptimizer?: Partial<OptimizerSettings> } }>(
    "SELECT settings FROM teams WHERE id = $1",
    [teamId],
  );
  const overrides = res.rows[0]?.settings?.planOptimizer ?? {};
  return { ...DEFAULT_OPTIMIZER_SETTINGS, ...overrides };
}
