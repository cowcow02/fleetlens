import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadGroupBySlug, listGroupsManagedBy, listGroupsForTeam } from "../../../../../../lib/groups";
import { ManagerInviteForm } from "../../../../../../components/manager-invite-form";

export default async function GroupInvitePage({ params }: { params: Promise<{ slug: string; group: string }> }) {
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
  const availableGroups = isAdminOrStaff
    ? await listGroupsForTeam(teamId, pool)
    : await listGroupsManagedBy(m.id, pool);
  if (!availableGroups.find((g) => g.id === group.id)) notFound();

  return (
    <>
      <div className="section-head">
        <div>
          <h1>Invite to <em>{group.name}</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            New member · role locked to member
          </div>
        </div>
      </div>
      <ManagerInviteForm
        teamSlug={slug}
        groupSlug={group.slug}
        availableGroups={availableGroups}
        preselectedGroupId={group.id}
      />
    </>
  );
}
