// The one seam between daily_rollups (base superset — every push writes it)
// and rich_daily_rollups (only written when the member's perception entries
// existed at push time). Emitted as a FULL OUTER JOIN with each side filtered
// inside its own subquery — hoisting the filters above the join would break
// outer semantics and drop backfill-only members. Callers COALESCE(d.x, r.x)
// preferring d for base metrics and default rich-only columns so a
// backfill-only member still counts.
//
// `team`/`memberIds`/`dayStart`/`dayEnd` are SQL parameter expressions (e.g.
// "$1", "$3::date", "($3::date - INTERVAL '30 days')::date"); `baseCols` are
// extra daily_rollups columns projected on BOTH sides, `richCols` only on r.
export function rollupJoin(p: {
  team: string;
  memberIds: string;
  dayStart: string;
  dayEnd: string;
  baseCols?: string[];
  richCols?: string[];
}): string {
  const base = [
    "membership_id",
    "day",
    "agent_time_ms",
    "COALESCE(unique_sessions, sessions) AS sessions",
    ...(p.baseCols ?? []),
  ].join(", ");
  const rich = [base, ...(p.richCols ?? [])].join(", ");
  const filter = `WHERE team_id = ${p.team} AND membership_id = ANY(${p.memberIds}::uuid[])
             AND day >= ${p.dayStart} AND day < ${p.dayEnd}`;
  return `FROM (SELECT ${base}
           FROM daily_rollups
           ${filter}) d
     FULL OUTER JOIN (SELECT ${rich}
           FROM rich_daily_rollups
           ${filter}) r
       ON r.membership_id = d.membership_id AND r.day = d.day`;
}
