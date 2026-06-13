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
import { buildMockGroupReport } from "../../../../../../lib/mock-group-report";
import { ReportHeader } from "../../../../../../components/report-header";
import { GroupMomentumReport } from "../../../../../../components/group-momentum-report";
import { SeatRightSizing, type SeatCandidate } from "../../../../../../components/seat-right-sizing";
import { ReportOptions } from "../../../../../../components/report-options";

export const dynamic = "force-dynamic";

// Per-group momentum dashboard. Renders the full live insight report scoped to
// one group's roster (buildTeamInsightReport with group scope) through the
// focused, framework-aligned GroupMomentumReport layout. The per-member
// coaching portraits are gated behind ?coaching=1 — reachable only by the
// group's manager or a team admin/staff (guarded below). When coaching is off
// the portrait data is stripped from the report before it crosses to the
// client component, so it never ships in the RSC payload.
export default async function GroupInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; group: string }>;
  searchParams: Promise<{ coaching?: string; explain?: string; mock?: string; week?: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const sp = await searchParams;
  const coaching = sp?.coaching === "1";
  const explain = sp?.explain === "1";
  const mock = sp?.mock === "1";
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

  let report: TeamInsightReport;
  let trend: MomentumTrendWeek[];
  let seatCandidates: SeatCandidate[];
  let seatReviewed: number;
  let seatInsufficient: number;
  let activeCount: number;
  // Earliest week with data — the floor for week navigation. Null in mock mode
  // (synthetic single week) so the arrows hide.
  let earliest: string | null = null;

  if (mock) {
    // ?mock=1 — synthesize metrics for the REAL roster, no DB activity rows.
    const rosterRes = membersTotal === 0
      ? { rows: [] as Array<{ id: string; name: string; tier: string }> }
      : await pool.query<{ id: string; name: string; tier: string }>(
          `SELECT m.id, COALESCE(NULLIF(ua.display_name, ''), split_part(ua.email, '@', 1)) AS name,
                  m.plan_tier AS tier
           FROM memberships m JOIN user_accounts ua ON ua.id = m.user_account_id
           WHERE m.id = ANY($1::uuid[]) ORDER BY m.id`,
          [groupMemberIds],
        );
    const md = buildMockGroupReport(
      rosterRes.rows.map((r) => ({ membershipId: r.id, name: r.name, tier: r.tier })),
    );
    report = md.report;
    trend = md.trend;
    seatCandidates = md.seatCandidates;
    seatReviewed = md.seatReviewed;
    seatInsufficient = md.seatInsufficient;
    activeCount = md.activeCount;
  } else {
    const groupIds = new Set(groupMemberIds);
    const [rep, tr, optimizerInputs, earliestM] = await Promise.all([
      buildTeamInsightReport(teamId, scope, pool, { teamSlug: slug, teamName, membersTotal }, weekMonday),
      groupMomentumTrend(teamId, scope, weekMonday, pool, 4),
      loadOptimizerInputs(teamId, pool),
      scopedSourceNames(teamId, scope, pool).then((src) => earliestWeekMonday(teamId, groupMemberIds, pool, src)),
    ]);
    report = rep;
    trend = tr;
    earliest = earliestM;
    // Roster includes every visible member (left join); count only those with
    // agent time this week so the header isn't a misleading N/N.
    activeCount = rep.cross_edition.roster.filter((rm) => rm.agent_hours > 0).length;
    // Seat right-sizing (Phase 1b): only downgrade candidates within the group.
    const groupSeatRecs = optimizerInputs
      .filter((i) => groupIds.has(i.membershipId))
      .map((i) => ({ input: i, rec: recommend(i.stats, tierEntry(i.tierKey)) }));
    seatCandidates = groupSeatRecs
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
    seatReviewed = groupSeatRecs.filter((r) => r.rec.action !== "insufficient_data").length;
    seatInsufficient = groupSeatRecs.filter((r) => r.rec.action === "insufficient_data").length;
  }

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);

  // Strip the per-member portraits unless coaching is on, so the sensitive
  // detail never reaches the client component's serialized props.
  const clientReport =
    coaching || !report.live_extras
      ? report
      : { ...report, live_extras: { ...report.live_extras, member_portraits: undefined } };

  // Toggle/nav links preserve the other view flags + the viewed week.
  const base = `/team/${slug}/groups/${group.slug}/insights`;
  const qs = (next: { coaching?: boolean; explain?: boolean; mock?: boolean; week?: string }) => {
    const c = next.coaching ?? coaching;
    const e = next.explain ?? explain;
    const k = next.mock ?? mock;
    const w = next.week ?? weekMonday;
    const parts = [
      c ? "coaching=1" : "",
      e ? "explain=1" : "",
      k ? "mock=1" : "",
      // Only pin the week when it isn't the default (last completed).
      w !== lastCompletedWeekMonday() ? `week=${w}` : "",
    ].filter(Boolean);
    return parts.length ? `${base}?${parts.join("&")}` : base;
  };

  // Week navigation, bounded by [earliest data week, last completed week].
  // Hidden in mock mode (single synthetic week).
  const last = lastCompletedWeekMonday();
  const prevM = previousIsoMonday(weekMonday);
  const nextM = nextIsoMonday(weekMonday);
  const showWeekNav = !mock && earliest !== null;
  const prevWeekHref = showWeekNav ? (prevM >= earliest! ? qs({ week: prevM }) : null) : undefined;
  const nextWeekHref = showWeekNav ? (nextM <= last ? qs({ week: nextM }) : null) : undefined;

  const pdfHref = `/api/team/${encodeURIComponent(slug)}/insights/pdf?group=${encodeURIComponent(group.slug)}${coaching ? "&coaching=1" : ""}${mock ? "&mock=1" : ""}${weekMonday !== last ? `&week=${weekMonday}` : ""}`;

  return (
    <>
      <div className="section-head" style={{ marginBottom: 4 }}>
        <div className="kicker report-breadcrumb">
          <a href={`/team/${slug}/groups/${group.slug}`}>← {group.name}</a>
          <span className="sep" aria-hidden>·</span>
          <a href={`/team/${slug}`}>{teamName}</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ReportOptions
            options={[
              {
                key: "mock",
                label: "Mock data",
                description: "Synthesized demo metrics from the real roster",
                active: mock,
                href: qs({ mock: !mock }),
              },
              {
                key: "explain",
                label: "Explain metrics",
                description: "Inline notes on how each number is computed",
                active: explain,
                href: qs({ explain: !explain }),
              },
              {
                key: "coaching",
                label: "Per-member coaching detail",
                description: "Per-member maturity portraits — manager reading",
                active: coaching,
                href: qs({ coaching: !coaching }),
              },
            ]}
          />
          <a href={pdfHref} className="btn">Export PDF</a>
        </div>
      </div>

      {mock && (
        <div className="explain-banner" style={{ borderColor: "var(--warning, #b06a00)", marginBottom: 12 }}>
          <strong>Mock data.</strong> Metrics on this view are synthesized from the real roster for
          alignment/demo — they are <em>not</em> actual activity. Switch to “Use real data” for live numbers.
        </div>
      )}

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
          <GroupMomentumReport report={clientReport} coaching={coaching} trend={trend} explain={explain} mock={mock} />
          <SeatRightSizing
            candidates={seatCandidates}
            reviewedCount={seatReviewed}
            insufficientCount={seatInsufficient}
            explain={explain}
          />
        </>
      )}
    </>
  );
}
