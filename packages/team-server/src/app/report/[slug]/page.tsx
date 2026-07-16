import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { loadGroupBySlug } from "../../../lib/groups";
import { groupMomentumTrend, resolveWeekMonday, visibleMembershipIds } from "../../../lib/insights-aggregate";
import { buildTeamInsightReport } from "../../../lib/team-report-aggregate";
import { GroupMomentumReport } from "../../../components/group-momentum-report";
import { ReportHeader } from "../../../components/report-header";
import { verifyRenderToken } from "../../../lib/render-token";

export const dynamic = "force-dynamic";

// PDF render target for the per-group momentum report. Insights are
// group-scoped only, so `?group=<slug>` is required — there is no team-wide
// report. Same layout the live group page shows, per-member portraits
// included. Group access is guarded to admin/staff or the group's manager.
//
// Only the PDF route is meant to load this page: it mints a short-lived
// `render` token over the exact scope, verified here before anything else so
// plain browser sessions (even admins) get a 404. The session + role checks
// below are kept as defense in depth.
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ group?: string; week?: string; render?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  if (!sp?.group) notFound();
  const renderScope = { slug, group: sp.group, week: sp.week };
  if (!verifyRenderToken(sp.render, renderScope)) notFound();

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

  const group = await loadGroupBySlug(teamId, sp.group, pool);
  if (!group) notFound();
  const isAdminOrStaff = session.user.is_staff || myMembership.role === "admin";
  if (!isAdminOrStaff) {
    const r = await pool.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND membership_id = $2 AND is_manager = true",
      [group.id, myMembership.id],
    );
    if (!r.rowCount) notFound();
  }
  const scope = { kind: "group" as const, groupId: group.id };
  const groupMemberIds = await visibleMembershipIds(teamId, scope, pool);
  const membersTotal = groupMemberIds.length;
  const weekMonday = resolveWeekMonday(sp?.week);

  const [report, trend] = await Promise.all([
    buildTeamInsightReport(teamId, scope, pool, { teamSlug: slug, teamName, membersTotal }, weekMonday),
    groupMomentumTrend(teamId, scope, weekMonday, pool, 4),
  ]);
  // Count only members with agent time this week (roster left-joins all
  // visible members) so the header isn't a misleading N/N.
  const activeCount = report.cross_edition.roster.filter((rm) => rm.agent_hours > 0).length;

  const ws = new Date(`${report.week_monday}T12:00:00`);
  const we = new Date(ws);
  we.setDate(ws.getDate() + 6);
  return (
    <>
      <ReportHeader
        teamName={group.name}
        weekStart={ws}
        weekEnd={we}
        activeCount={activeCount}
        memberTotal={membersTotal}
        agentHours={report.volume.agent_hours_total}
        generatedAt={new Date()}
        roster={report.cross_edition.roster.map((m) => m.display_name)}
      />
      <GroupMomentumReport report={report} trend={trend} />
    </>
  );
}
