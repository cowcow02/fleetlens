import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadGroupBySlug } from "../../../../../../lib/groups";
import {
  isoMondayOf,
  perProjectTimeWoW,
  skillUsageWeek,
  teamPulseWeek,
  workingShapeDistribution,
} from "../../../../../../lib/insights-aggregate";
import { LiveInsights, type LiveInsightsData } from "../../../../../../components/live-insights";

export const dynamic = "force-dynamic";

export default async function GroupInsightsPage({
  params,
}: {
  params: Promise<{ slug: string; group: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const teamId = teamRes.rows[0].id;
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

  const weekMonday = isoMondayOf(new Date());
  const scope = { kind: "group" as const, groupId: group.id };
  const [pulse, projects, skills, shapes] = await Promise.all([
    teamPulseWeek(teamId, scope, weekMonday, pool),
    perProjectTimeWoW(teamId, scope, weekMonday, pool, { limit: 12 }),
    skillUsageWeek(teamId, scope, weekMonday, pool, { limit: 20 }),
    workingShapeDistribution(teamId, scope, weekMonday, pool),
  ]);

  const data: LiveInsightsData = {
    scopeLabel: group.name,
    weekMonday,
    pulse,
    projects,
    skills,
    shapes,
  };
  return <LiveInsights data={data} slug={slug} />;
}
