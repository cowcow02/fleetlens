import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadGroupBySlug } from "../../../../../../lib/groups";
import { groupMomentumTrend, resolveWeekMonday, lastCompletedWeekMonday, previousIsoMonday, nextIsoMonday, earliestWeekMonday, visibleMembershipIds, type MomentumTrendWeek } from "../../../../../../lib/insights-aggregate";
import type { TeamInsightReport } from "../../../insights/types";
import { buildTeamInsightReport, scopedSourceNames } from "../../../../../../lib/team-report-aggregate";
import { loadOptimizerInputs } from "../../../../../../lib/plan-queries";
import { recommend } from "../../../../../../lib/plan-optimizer";
import { tierEntry } from "../../../../../../lib/plan-tiers";
import { ReportHeader } from "../../../../../../components/report-header";
import { GroupMomentumReport } from "../../../../../../components/group-momentum-report";
import { SeatRightSizing, type SeatCandidate } from "../../../../../../components/seat-right-sizing";

export const dynamic = "force-dynamic";

// Per-group momentum dashboard. Renders the full live insight report scoped to
// one group's roster (buildTeamInsightReport with group scope) through the
// focused, framework-aligned GroupMomentumReport layout — per-member portraits
// and metric provenance included. Access is guarded to the group's manager or
// a team admin/staff, so nothing here needs a view toggle.
export default async function GroupInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; group: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const sp = await searchParams;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const teamId = teamRes.rows[0].id;
  const teamName = teamRes.rows[0].name;
  const m = session.memberships.find((x) => x.team_id === teamId);
  if (!m) redirect("/login");

  const group = await loadGroupBySlug(teamId, groupSlug, pool);
  if (!group) notFound();

  const isAdminOrStaff = session.user.is_staff || m.role === "admin";
  if (!isAdminOrStaff) {
    const r = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2 AND is_manager = true",
      [group.id, m.id],
    );
    if (!r.rowCount) notFound();
  }

  const scope = { kind: "group" as const, groupId: group.id };
  // membersTotal MUST be the group roster size — active_rate % and the L0
  // backfill are computed against it; the whole-team count would over-count.
  const groupMemberIds = await visibleMembershipIds(teamId, scope, pool);
  const membersTotal = groupMemberIds.length;

  const weekMonday = resolveWeekMonday(sp?.week);

  const groupIds = new Set(groupMemberIds);
  const [report, trend, optimizerInputs, earliest]: [TeamInsightReport, MomentumTrendWeek[], Awaited<ReturnType<typeof loadOptimizerInputs>>, string | null] = await Promise.all([
    buildTeamInsightReport(teamId, scope, pool, { teamSlug: slug, teamName, membersTotal }, weekMonday),
    groupMomentumTrend(teamId, scope, weekMonday, pool, 4),
    loadOptimizerInputs(teamId, pool),
    scopedSourceNames(teamId, scope, pool).then((src) => earliestWeekMonday(teamId, groupMemberIds, pool, src)),
  ]);
  // Roster includes every visible member (left join); count only those with
  // agent time this week so the header isn't a misleading N/N.
  const activeCount = report.cross_edition.roster.filter((rm) => rm.agent_hours > 0).length;
  // Seat right-sizing (Phase 1b): only downgrade candidates within the group.
  const groupSeatRecs = optimizerInputs
    .filter((i) => groupIds.has(i.membershipId))
    .map((i) => ({ input: i, rec: recommend(i.stats, tierEntry(i.tierKey)) }));
  const seatCandidates: SeatCandidate[] = groupSeatRecs
    .filter((r) => r.rec.action === "downgrade")
    .map((r) => {
      const rec = r.rec as Extract<typeof r.rec, { action: "downgrade" }>;
      return {
        name: r.input.memberName,
        fromTier: tierEntry(r.input.tierKey).label,
        toTier: tierEntry(rec.targetTier).label,
        avgPct: Math.round(r.input.stats.avgSevenDayAvg),
        peakPct: Math.round(r.input.stats.worstSevenDayPeak),
        savingsUsd: rec.estimatedSavingsUsd,
      };
    });
  const seatReviewed = groupSeatRecs.filter((r) => r.rec.action !== "insufficient_data").length;
  const seatInsufficient = groupSeatRecs.filter((r) => r.rec.action === "insufficient_data").length;

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);

  // Week navigation, bounded by [earliest data week, last completed week].
  const base = `/team/${slug}/groups/${group.slug}/insights`;
  const weekHref = (w: string) =>
    // Only pin the week when it isn't the default (last completed).
    w !== lastCompletedWeekMonday() ? `${base}?week=${w}` : base;
  const last = lastCompletedWeekMonday();
  const prevM = previousIsoMonday(weekMonday);
  const nextM = nextIsoMonday(weekMonday);
  const showWeekNav = earliest !== null;
  const prevWeekHref = showWeekNav ? (prevM >= earliest! ? weekHref(prevM) : null) : undefined;
  const nextWeekHref = showWeekNav ? (nextM <= last ? weekHref(nextM) : null) : undefined;

  const pdfHref = `/api/team/${encodeURIComponent(slug)}/insights/pdf?group=${encodeURIComponent(group.slug)}${weekMonday !== last ? `&week=${weekMonday}` : ""}`;

  return (
    <>
      <div className="section-head" style={{ marginBottom: 4 }}>
        <div className="kicker report-breadcrumb">
          <a href={`/team/${slug}/groups/${group.slug}`}>← {group.name}</a>
          <span className="sep" aria-hidden>·</span>
          <a href={`/team/${slug}`}>{teamName}</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href={pdfHref} className="btn">Export PDF</a>
        </div>
      </div>

      <ReportHeader
        teamName={group.name}
        weekStart={weekDate}
        weekEnd={weekEnd}
        activeCount={activeCount}
        memberTotal={membersTotal}
        agentHours={report.volume.agent_hours_total}
        generatedAt={new Date(report.generated_at)}
        roster={report.cross_edition.roster.map((rm) => rm.display_name)}
        prevWeekHref={prevWeekHref}
        nextWeekHref={nextWeekHref}
      />

      {membersTotal === 0 ? (
        <div className="live-empty">
          <h2>No members in this group yet</h2>
          <p>Add members to {group.name} to see its momentum.</p>
        </div>
      ) : (
        <>
          <GroupMomentumReport report={report} trend={trend} />
          <SeatRightSizing
            candidates={seatCandidates}
            reviewedCount={seatReviewed}
            insufficientCount={seatInsufficient}
          />
        </>
      )}
    </>
  );
}
