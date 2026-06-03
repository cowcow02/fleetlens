import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { loadGroupBySlug } from "../../../lib/groups";
import { groupMomentumTrend, resolveWeekMonday, visibleMembershipIds } from "../../../lib/insights-aggregate";
import { buildTeamInsightReport, LIVE_STARTER_BLOCKS_V8 } from "../../../lib/team-report-aggregate";
import { VariantBuilder } from "../../../components/insights-variants/v7-builder";
import { GroupMomentumReport } from "../../../components/group-momentum-report";
import { ReportHeader } from "../../../components/report-header";
import { buildMockGroupReport } from "../../../lib/mock-group-report";
import { mockTeamInsightReport } from "../../../lib/insights-mock-data";

export const dynamic = "force-dynamic";

// PDF render target. Defaults to live data (`source=live`); pass
// `?source=preview` to capture the v7 mock report (used by the
// /insights/preview "Export PDF" button so the mock-PDF path keeps working).
// Pass `?group=<slug>` to render the per-group momentum report instead — same
// layout the live group page shows, with `?coaching=1` revealing per-member
// portraits. Group access is guarded to admin/staff or the group's manager.
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ blocks?: string; source?: string; group?: string; coaching?: string; mock?: string; week?: string }>;
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

  // ── Per-group momentum report ──────────────────────────────────────────
  if (!useMock && sp?.group) {
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
    const coaching = sp.coaching === "1";
    const mock = sp.mock === "1";

    let report;
    let trend;
    let activeCount: number;
    if (mock) {
      const rosterRes = membersTotal === 0
        ? { rows: [] as Array<{ id: string; name: string; tier: string }> }
        : await pool.query<{ id: string; name: string; tier: string }>(
            `SELECT m.id, COALESCE(NULLIF(ua.display_name, ''), split_part(ua.email, '@', 1)) AS name,
                    m.plan_tier AS tier
             FROM memberships m JOIN user_accounts ua ON ua.id = m.user_account_id
             WHERE m.id = ANY($1::uuid[]) ORDER BY m.id`,
            [groupMemberIds],
          );
      const md = buildMockGroupReport(rosterRes.rows.map((r) => ({ membershipId: r.id, name: r.name, tier: r.tier })));
      report = md.report;
      trend = md.trend;
      activeCount = md.activeCount;
    } else {
      const [rep, tr] = await Promise.all([
        buildTeamInsightReport(teamId, scope, pool, { teamSlug: slug, teamName, membersTotal }, weekMonday),
        groupMomentumTrend(teamId, scope, weekMonday, pool, 4),
      ]);
      report = rep;
      trend = tr;
      // Count only members with agent time this week (roster left-joins all
      // visible members) so the header isn't a misleading N/N.
      activeCount = rep.cross_edition.roster.filter((rm) => rm.agent_hours > 0).length;
    }
    const ws = new Date(`${report.week_monday}T12:00:00`);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    const clientReport =
      coaching || !report.live_extras
        ? report
        : { ...report, live_extras: { ...report.live_extras, member_portraits: undefined } };
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
        <GroupMomentumReport report={clientReport} coaching={coaching} trend={trend} />
      </>
    );
  }

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
    const weekMonday = resolveWeekMonday(sp?.week);
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
