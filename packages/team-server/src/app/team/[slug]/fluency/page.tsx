import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Fluency } from "@claude-lens/entries";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
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

  const baseReport = Fluency.TEAM_FLUENCY_REPORT;
  // Adopt the browsed team's name / slug so the prototype renders at-home
  // inside whichever team the URL points at.
  const report = { ...baseReport, team_name: teamName, team_slug: slug };

  return (
    <>
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
