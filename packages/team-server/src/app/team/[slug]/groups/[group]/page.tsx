import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadGroupBySlug } from "../../../../../lib/groups";
import { loadGroupRoster, parseRange, RANGE_DAYS } from "../../../../../lib/queries";
import { listGroupsForTeam } from "../../../../../lib/groups";
import { RosterCard } from "../../../../../components/roster-card";
import { RangeTabs } from "../../../../../components/range-tabs";
import { GroupDetailActions } from "../../../../../components/group-detail-actions";
import type { SettingsTab } from "../../../../../components/group-settings-modal";

const SETTINGS_TABS = new Set(["members", "invites", "sources", "general"]);

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; group: string }>;
  searchParams: Promise<{ range?: string; settings?: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const { range: rangeParam, settings: settingsParam } = await searchParams;
  const range = parseRange(rangeParam);
  const days = RANGE_DAYS[range];
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

  const roster = await loadGroupRoster(group.id, days, pool);
  const totalAgentMs = roster.reduce((sum, r) => sum + Number(r.range_agent_time_ms), 0);
  const managerCount = roster.filter((r) => r.is_manager).length;

  // Settings-modal inputs: the current group's members (with manager flags) and
  // the full team roster / group list for the add-members and invite tabs.
  const members = roster.map((r) => ({
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    is_manager: r.is_manager,
  }));
  const allMembersRes = await pool.query<{ id: string; email: string | null; display_name: string | null }>(
    `SELECT m.id, u.email, u.display_name
     FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1 AND m.revoked_at IS NULL ORDER BY u.email`,
    [teamId],
  );
  const allGroups = await listGroupsForTeam(teamId, pool);
  const autoOpenTab = settingsParam && SETTINGS_TABS.has(settingsParam) ? (settingsParam as SettingsTab) : null;

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>{group.name}</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Last {days} days
            {" · "}
            {roster.length} {roster.length === 1 ? "member" : "members"}
            {" · "}
            {managerCount} {managerCount === 1 ? "manager" : "managers"}
            {" · "}
            {(totalAgentMs / 3600000).toFixed(1)}h combined agent time
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a href={`/team/${slug}/groups/${group.slug}/insights`} className="btn">
            Insight report
          </a>
          <RangeTabs value={range} />
          <GroupDetailActions
            teamSlug={slug}
            group={{ id: group.id, slug: group.slug, name: group.name }}
            members={members}
            allMembers={allMembersRes.rows}
            allGroups={allGroups.map((g) => ({ id: g.id, slug: g.slug, name: g.name }))}
            autoOpenTab={autoOpenTab}
          />
        </div>
      </div>
      <div className="roster-grid">
        {roster.map((r) => <RosterCard key={r.id} member={r} teamSlug={slug} />)}
      </div>
    </>
  );
}
