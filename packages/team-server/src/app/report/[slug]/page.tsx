import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { VariantBuilder } from "../../../components/insights-variants/v7-builder";
import { ReportHeader } from "../../../components/report-header";
import { mockTeamInsightReport } from "../../team/[slug]/insights/mock-data";

export const dynamic = "force-dynamic";

export default async function ReportPage({
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

  const r = mockTeamInsightReport;
  const weekDate = new Date(`${r.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const generatedAt = new Date();

  return (
    <>
      <ReportHeader
        teamName={teamName}
        weekStart={weekDate}
        weekEnd={weekEnd}
        activeCount={r.cross_edition.roster.length}
        memberTotal={r.members_total}
        agentHours={r.volume.agent_hours_total}
        generatedAt={generatedAt}
        roster={r.cross_edition.roster.map((m) => m.display_name)}
      />
      <VariantBuilder r={r} slug={slug} blocksParam={sp?.blocks} pdfMode />
    </>
  );
}
