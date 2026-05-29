import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { isoMondayOf } from "../../../lib/insights-aggregate";
import { buildTeamInsightReport, LIVE_STARTER_BLOCKS_V8 } from "../../../lib/team-report-aggregate";
import { VariantBuilder } from "../../../components/insights-variants/v7-builder";
import { ReportHeader } from "../../../components/report-header";
import { mockTeamInsightReport } from "../../../lib/insights-mock-data";

export const dynamic = "force-dynamic";

// PDF render target. Defaults to live data (`source=live`); pass
// `?source=preview` to capture the v7 mock report (used by the
// /insights/preview "Export PDF" button so the mock-PDF path keeps working).
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ blocks?: string; source?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const useMock = sp?.source === "preview";

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

  let report;
  let membersTotal: number;
  if (useMock) {
    report = mockTeamInsightReport;
    membersTotal = report.members_total;
  } else {
    const memberCountRes = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM memberships WHERE team_id = $1 AND revoked_at IS NULL",
      [teamId],
    );
    membersTotal = Number(memberCountRes.rows[0]?.count ?? 0);
    const weekMonday = isoMondayOf(new Date());
    report = await buildTeamInsightReport(
      teamId,
      { kind: "team-wide" },
      pool,
      { teamSlug: slug, teamName, membersTotal },
      weekMonday,
    );
  }

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const generatedAt = useMock ? new Date(report.generated_at) : new Date();
  const blocksParam = sp?.blocks ?? (useMock ? undefined : LIVE_STARTER_BLOCKS_V8.join(","));

  return (
    <>
      <ReportHeader
        teamName={teamName}
        weekStart={weekDate}
        weekEnd={weekEnd}
        activeCount={report.cross_edition.roster.length}
        memberTotal={membersTotal}
        agentHours={report.volume.agent_hours_total}
        generatedAt={generatedAt}
        roster={report.cross_edition.roster.map((m) => m.display_name)}
      />
      <VariantBuilder r={report} slug={slug} blocksParam={blocksParam} pdfMode />
    </>
  );
}
