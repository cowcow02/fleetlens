import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { isoMondayOf } from "../../../../lib/insights-aggregate";
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
  searchParams: Promise<{ blocks?: string }>;
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

  const memberCountRes = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM memberships WHERE team_id = $1 AND revoked_at IS NULL",
    [teamId],
  );
  const membersTotal = Number(memberCountRes.rows[0]?.count ?? 0);

  const weekMonday = isoMondayOf(new Date());
  const report = await buildTeamInsightReport(
    teamId,
    { kind: "team-wide" },
    pool,
    { teamSlug: slug, teamName, membersTotal },
    weekMonday,
  );

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const blocksParam = sp?.blocks ?? LIVE_STARTER_BLOCKS_V8.join(",");

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
      />
      <VariantBuilder r={report} slug={slug} blocksParam={blocksParam} />
    </>
  );
}
