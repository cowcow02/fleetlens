import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { resolveWeekMonday, lastCompletedWeekMonday, previousIsoMonday, nextIsoMonday, earliestWeekMonday, visibleMembershipIds } from "../../../../lib/insights-aggregate";
import { buildTeamInsightReport, LIVE_STARTER_BLOCKS_V8 } from "../../../../lib/team-report-aggregate";
import { VariantBuilder } from "../../../../components/insights-variants/v7-builder";
import { ReportHeader } from "../../../../components/report-header";

export const dynamic = "force-dynamic";

// /team/[slug]/insights serves the live-data dashboard backed by
// rich_daily_rollups, rendered through the v7 VariantBuilder so eng leads get
// the same UI/UX they saw on /insights/preview but populated with real
// week-over-week aggregates.
export default async function TeamInsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ blocks?: string; week?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const teamName = teamRes.rows[0].name;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  const memberIds = await visibleMembershipIds(teamId, { kind: "team-wide" }, pool);
  const membersTotal = memberIds.length;

  const weekMonday = resolveWeekMonday(sp?.week);
  const [report, earliest] = await Promise.all([
    buildTeamInsightReport(
      teamId,
      { kind: "team-wide" },
      pool,
      { teamSlug: slug, teamName, membersTotal },
      weekMonday,
    ),
    earliestWeekMonday(memberIds, pool),
  ]);

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const blocksParam = sp?.blocks ?? LIVE_STARTER_BLOCKS_V8.join(",");

  // Week navigation, bounded by [earliest data week, last completed week].
  const last = lastCompletedWeekMonday();
  const blocksQs = sp?.blocks ? `&blocks=${encodeURIComponent(sp.blocks)}` : "";
  const weekHref = (w: string) =>
    `/team/${slug}/insights?${w !== last ? `week=${w}` : ""}${blocksQs}`.replace(/\?&/, "?").replace(/\?$/, "");
  const prevM = previousIsoMonday(weekMonday);
  const nextM = nextIsoMonday(weekMonday);
  const prevWeekHref = earliest === null ? undefined : prevM >= earliest ? weekHref(prevM) : null;
  const nextWeekHref = earliest === null ? undefined : nextM <= last ? weekHref(nextM) : null;

  return (
    <>
      <ReportHeader
        teamName={teamName}
        weekStart={weekDate}
        weekEnd={weekEnd}
        activeCount={report.cross_edition.roster.length}
        memberTotal={membersTotal}
        agentHours={report.volume.agent_hours_total}
        generatedAt={new Date(report.generated_at)}
        roster={report.cross_edition.roster.map((m) => m.display_name)}
        prevWeekHref={prevWeekHref}
        nextWeekHref={nextWeekHref}
      />
      <VariantBuilder r={report} slug={slug} blocksParam={blocksParam} />
    </>
  );
}
