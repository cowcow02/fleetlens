import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadGroupBySlug } from "../../../../../../lib/groups";
import { groupMomentumTrend, isoMondayOf, visibleMembershipIds } from "../../../../../../lib/insights-aggregate";
import { buildTeamInsightReport } from "../../../../../../lib/team-report-aggregate";
import { loadOptimizerInputs } from "../../../../../../lib/plan-queries";
import { recommend } from "../../../../../../lib/plan-optimizer";
import { tierEntry } from "../../../../../../lib/plan-tiers";
import { ReportHeader } from "../../../../../../components/report-header";
import { GroupMomentumReport } from "../../../../../../components/group-momentum-report";
import { SeatRightSizing, type SeatCandidate } from "../../../../../../components/seat-right-sizing";

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
  searchParams: Promise<{ coaching?: string; explain?: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const sp = await searchParams;
  const coaching = sp?.coaching === "1";
  const explain = sp?.explain === "1";
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

  const weekMonday = isoMondayOf(new Date());
  const groupIds = new Set(groupMemberIds);
  const [report, trend, optimizerInputs] = await Promise.all([
    buildTeamInsightReport(teamId, scope, pool, { teamSlug: slug, teamName, membersTotal }, weekMonday),
    groupMomentumTrend(teamId, scope, weekMonday, pool, 4),
    loadOptimizerInputs(teamId, pool),
  ]);

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

  // Strip the per-member portraits unless coaching is on, so the sensitive
  // detail never reaches the client component's serialized props.
  const clientReport =
    coaching || !report.live_extras
      ? report
      : { ...report, live_extras: { ...report.live_extras, member_portraits: undefined } };

  // Toggle links preserve the other view flag.
  const base = `/team/${slug}/groups/${group.slug}/insights`;
  const qs = (next: { coaching?: boolean; explain?: boolean }) => {
    const c = next.coaching ?? coaching;
    const e = next.explain ?? explain;
    const parts = [c ? "coaching=1" : "", e ? "explain=1" : ""].filter(Boolean);
    return parts.length ? `${base}?${parts.join("&")}` : base;
  };
  const pdfHref = `/api/team/${encodeURIComponent(slug)}/insights/pdf?group=${encodeURIComponent(group.slug)}${coaching ? "&coaching=1" : ""}`;

  return (
    <>
      <div className="section-head" style={{ marginBottom: 4 }}>
        <div className="kicker">
          <a href={`/team/${slug}/groups/${group.slug}`}>← {group.name}</a>
          {" · "}
          {teamName}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href={qs({ explain: !explain })} className="btn secondary">
            {explain ? "Hide explanations" : "ⓘ Explain metrics"}
          </a>
          <a href={qs({ coaching: !coaching })} className="btn secondary">
            {coaching ? "Hide per-member detail" : "Show per-member coaching detail →"}
          </a>
          <a href={pdfHref} className="btn">Export PDF</a>
        </div>
      </div>

      <ReportHeader
        teamName={group.name}
        weekStart={weekDate}
        weekEnd={weekEnd}
        activeCount={report.cross_edition.roster.length}
        memberTotal={membersTotal}
        agentHours={report.volume.agent_hours_total}
        generatedAt={new Date(report.generated_at)}
        roster={report.cross_edition.roster.map((rm) => rm.display_name)}
      />

      {membersTotal === 0 ? (
        <div className="live-empty">
          <h2>No members in this group yet</h2>
          <p>Add members to {group.name} to see its momentum.</p>
        </div>
      ) : (
        <>
          <GroupMomentumReport report={clientReport} coaching={coaching} trend={trend} explain={explain} />
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
