import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import {
  listGroupsForTeam,
  listGroupsManagedBy,
  listGroupMembersByGroupForTeam,
} from "../../../../lib/groups";
import { GroupsList } from "../../../../components/groups-list";

export default async function GroupsListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const m = session.memberships.find((x) => x.team_id === teamId);
  if (!m) redirect("/login");

  const isAdminOrStaff = session.user.is_staff || m.role === "admin";

  if (!isAdminOrStaff) {
    const managed = await listGroupsManagedBy(m.id, pool);
    if (managed.length === 0) redirect(`/team/${slug}/members/${m.id}`);
    return (
      <>
        <div className="section-head">
          <div>
            <h1><em>Groups</em></h1>
            <div className="kicker" style={{ marginTop: 8 }}>
              Groups you manage · {managed.length} {managed.length === 1 ? "group" : "groups"}
            </div>
          </div>
        </div>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {managed.map((g) => (
            <li
              key={g.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--rule)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <a href={`/team/${slug}/groups/${g.slug}`}>
                <strong>{g.name}</strong>{" "}
                <small style={{ opacity: 0.6 }}>/{g.slug}</small>
              </a>
              <a
                href={`/team/${slug}/groups/${g.slug}?settings=members`}
                className="btn secondary"
                style={{ fontSize: 11 }}
              >
                ⚙ Settings
              </a>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const groups = await listGroupsForTeam(teamId, pool);
  const grouped = await listGroupMembersByGroupForTeam(teamId, pool);
  const membersByGroup = groups.map((g) => ({ group: g, members: grouped.get(g.id) ?? [] }));

  const allMembers = await pool.query(
    `SELECT m.id, u.email, u.display_name
     FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1 AND m.revoked_at IS NULL
     ORDER BY u.email`,
    [teamId],
  );

  return (
    <GroupsList
      teamSlug={slug}
      groups={membersByGroup}
      allMembers={allMembers.rows}
    />
  );
}
