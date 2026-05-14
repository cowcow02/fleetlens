import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { TeamPulseSection } from "../../../../components/team-pulse";
import { WorkingShapeDistributionSection } from "../../../../components/working-shape-distribution";
import { HarnessDiffusionSection } from "../../../../components/harness-diffusion";
import { ProjectsTableSection } from "../../../../components/projects-table";
import { SpotlightsSection } from "../../../../components/spotlight-card";
import { RosterSnapshotSection } from "../../../../components/roster-snapshot";
import { mockTeamInsightReport } from "./mock-data";

export const dynamic = "force-dynamic";

export default async function TeamInsightsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  // Phase 1: hardcoded mock report. Phase 2 swaps this for a real fetch.
  const report = mockTeamInsightReport;

  const weekDate = new Date(`${report.week_monday}T12:00:00`);
  const weekEnd = new Date(weekDate);
  weekEnd.setDate(weekDate.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Insight Report</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Week of {fmt(weekDate).toUpperCase()} — {fmt(weekEnd).toUpperCase()}
            {" · "}
            {report.pulse.members_active} of {report.pulse.members_total} members active
            {" · "}
            {report.pulse.agent_hours.toFixed(1)}h combined agent time
          </div>
        </div>
        <div className="kicker">Phase 1 · static prototype</div>
      </div>

      <TeamPulseSection pulse={report.pulse} />
      <WorkingShapeDistributionSection data={report.how_they_worked} />
      <HarnessDiffusionSection data={report.harness} />
      <ProjectsTableSection projects={report.projects} />
      <SpotlightsSection spotlights={report.spotlights} />
      <RosterSnapshotSection roster={report.roster} teamSlug={slug} />

      <footer className="page-footer">
        <span>Fleetlens · Team Edition · static prototype</span>
        <span>Generated {report.generated_at}</span>
      </footer>
    </>
  );
}
