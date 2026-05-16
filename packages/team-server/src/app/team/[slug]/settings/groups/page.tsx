import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { listGroupsForTeam, listGroupMembersByGroupForTeam } from "../../../../../lib/groups";
import { GroupsSettingsPanel } from "../../../../../components/groups-settings-panel";

export default async function GroupsSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const team = teamRes.rows[0];

  const m = session.memberships.find((x) => x.team_id === team.id);
  if (!m) redirect("/login");
  if (m.role !== "admin" && !session.user.is_staff) {
    return <div className="section-head"><div><h1>Admin <em>only</em></h1></div></div>;
  }

  const groups = await listGroupsForTeam(team.id, pool);
  const grouped = await listGroupMembersByGroupForTeam(team.id, pool);
  const membersByGroup = groups.map((g) => ({ group: g, members: grouped.get(g.id) ?? [] }));

  const allMembers = await pool.query(
    `SELECT m.id, u.email, u.display_name
     FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1 AND m.revoked_at IS NULL
     ORDER BY u.email`,
    [team.id],
  );

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Groups</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>{groups.length} groups</div>
        </div>
      </div>
      <GroupsSettingsPanel
        teamSlug={slug}
        groups={membersByGroup}
        allMembers={allMembers.rows}
      />
    </>
  );
}
