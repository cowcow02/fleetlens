import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { listGroupsForTeam, listGroupsManagedBy } from "../../../../lib/groups";

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
  const groups = isAdminOrStaff
    ? await listGroupsForTeam(teamId, pool)
    : await listGroupsManagedBy(m.id, pool);

  // Plain members with no managed groups → not allowed here.
  if (groups.length === 0 && !isAdminOrStaff) {
    redirect(`/team/${slug}/members/${m.id}`);
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Groups</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            {isAdminOrStaff ? "All groups" : "Groups you manage"}
            {" · "}
            {groups.length} {groups.length === 1 ? "group" : "groups"}
          </div>
        </div>
      </div>
      {groups.length === 0 ? (
        <div className="kicker" style={{ marginTop: 16 }}>
          No groups yet. {isAdminOrStaff && (
            <a href={`/team/${slug}/settings/groups`}>Create one in settings →</a>
          )}
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {groups.map((g) => (
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
                href={`/team/${slug}/groups/${g.slug}/invite`}
                className="btn secondary"
                style={{ fontSize: 11 }}
              >
                + Invite
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
