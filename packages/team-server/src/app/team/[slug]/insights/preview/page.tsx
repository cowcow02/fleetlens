import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { VariantBuilder } from "../../../../../components/insights-variants/v7-builder";
import { ReportHeader } from "../../../../../components/report-header";
import { mockTeamInsightReport } from "../../../../../lib/insights-mock-data";

export const dynamic = "force-dynamic";

// /team/[slug]/insights/preview is an invisible shareable preview of the
// v7-builder insight report against mock data. It is intentionally not linked
// from anywhere — share the URL directly with collaborators. Once the layout
// is locked, this route will be backed by the live rich-rollup queries and
// promoted into the main /team/[slug]/insights flow.
export default async function InsightsPreview({
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

  return (
    <>
      <div className="preview-banner">
        <span className="preview-banner-tag">Preview · mock data</span>
        <span className="preview-banner-text">
          Layout reference for the upcoming Insight Report. Numbers are illustrative.
        </span>
        <a className="preview-banner-link" href={`/team/${slug}/insights/preview/archive`}>
          See earlier iterations →
        </a>
      </div>
      <ReportHeader
        teamName={teamName}
        weekStart={weekDate}
        weekEnd={weekEnd}
        activeCount={r.cross_edition.roster.length}
        memberTotal={r.members_total}
        agentHours={r.volume.agent_hours_total}
        generatedAt={r.generated_at}
        roster={r.cross_edition.roster.map((m) => m.display_name)}
      />
      <VariantBuilder r={r} slug={slug} blocksParam={sp?.blocks} pdfSource="preview" />
    </>
  );
}
