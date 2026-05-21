import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import {
  isoMondayOf,
  perProjectTimeWoW,
  skillUsageWeek,
  teamPulseWeek,
  workingShapeDistribution,
} from "../../../../lib/insights-aggregate";
import { LiveInsights, type LiveInsightsData } from "../../../../components/live-insights";

export const dynamic = "force-dynamic";

// /team/[slug]/insights serves the live-data dashboard backed by
// rich_daily_rollups. The v7 mock report and earlier prototype variants now
// live under /team/[slug]/insights/preview (prime) and
// /team/[slug]/insights/preview/archive (v0–v6 reference) so this page stays
// focused on real data.
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

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const teamName = teamRes.rows[0].name;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  const weekMonday = isoMondayOf(new Date());
  const scope = { kind: "team-wide" as const };
  const [pulse, projects, skills, shapes] = await Promise.all([
    teamPulseWeek(teamId, scope, weekMonday, pool),
    perProjectTimeWoW(teamId, scope, weekMonday, pool, { limit: 12 }),
    skillUsageWeek(teamId, scope, weekMonday, pool, { limit: 20 }),
    workingShapeDistribution(teamId, scope, weekMonday, pool),
  ]);
  const data: LiveInsightsData = {
    scopeLabel: `All of ${teamName}`,
    weekMonday,
    pulse,
    projects,
    skills,
    shapes,
  };
  return <LiveInsights data={data} slug={slug} />;
}
