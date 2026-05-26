import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Fluency } from "@claude-lens/entries";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { readLatestTeamAggregate } from "../../../../lib/fluency-aggregate";
import {
  DiffusionBlock,
  DistributionBlock,
  FluencyHeadline,
  HighlightsBlock,
  NormProposalBlock,
  NormsDriftBlock,
  PrivacyStrip,
  SurfaceMixBlock,
  TeamRiskTriangle,
} from "../../../../components/team-fluency-report";

export const dynamic = "force-dynamic";

/**
 * Team AI Fluency report.
 *
 * Phase 1: renders the prototype against `Fluency.TEAM_FLUENCY_REPORT`
 * — realistic mock data shaped exactly like Phase 2 will produce. The
 * route, layout, and styling are real; only the data is mocked.
 *
 * Phase 2: replace the mock import with a query over
 * `fluency_team_aggregate` populated by the daemon push pipeline.
 */
export default async function TeamFluencyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const demo = process.env.FLEETLENS_FLUENCY_DEMO === "1";
  let teamName = "Demo team";
  if (!demo) {
    const pool = getPool();
    const cookieStore = await cookies();
    const token = cookieStore.get("fleetlens_session")?.value;
    const session = token ? await validateSession(token, pool) : null;
    if (!session) redirect("/login");

    const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
    if (!teamRes.rowCount) return <div>Team not found.</div>;
    teamName = teamRes.rows[0].name;
    const teamId = teamRes.rows[0].id;
    const myMembership = session.memberships.find((m) => m.team_id === teamId);
    if (!myMembership) redirect("/login");
  } else {
    teamName = "Kipwise Engineering";
  }

  // Real path: latest aggregate from DB. Try this whether demo mode is on or
  // not — if real scorecards exist for this team, we want to show them. Demo
  // mode only relaxes the auth gate; the data layer always prefers real over
  // mock.
  let report: Fluency.TeamFluencyReport | null = null;
  const pool = getPool();
  const teamIdRes = await pool.query<{ id: string }>(
    "SELECT id FROM teams WHERE slug = $1",
    [slug],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  const teamId = teamIdRes.rows[0]?.id;
  if (teamId) {
    report = await readLatestTeamAggregate(teamId, null, pool).catch(() => null);
  }
  let isMock = false;
  if (!report) {
    isMock = true;
    const base = Fluency.TEAM_FLUENCY_REPORT;
    report = { ...base, team_name: teamName, team_slug: slug };
  }

  return (
    <>
      {isMock && <DemoBanner />}
      <FluencyHeadline report={report} />
      <DistributionBlock rows={report.distribution} />
      <TeamRiskTriangle position={report.risk_triangle} prev={report.risk_triangle.prev} />
      <DiffusionBlock edges={report.diffusion} />
      <NormsDriftBlock trajectories={report.norms_trajectory} />
      <HighlightsBlock highlights={report.highlights} />
      <SurfaceMixBlock mix={report.surface_mix} />
      <NormProposalBlock proposal={report.norm_proposal} />
      <PrivacyStrip />
    </>
  );
}

function DemoBanner() {
  return (
    <div
      style={{
        marginBottom: 18,
        padding: "12px 16px",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent)",
        borderRadius: 2,
        fontSize: 13,
        color: "var(--ink)",
      }}
    >
      <strong>Showing the prototype mock data.</strong> No member has pushed a fluency scorecard
      to this team yet. Once a paired CLI runs <code>fleetlens fluency --push</code>, this page
      renders the live team aggregate.
    </div>
  );
}
