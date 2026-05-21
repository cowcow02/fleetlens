import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadGroupBySlug } from "../../../../../lib/groups";
import { loadGroupRoster, parseRange, RANGE_DAYS } from "../../../../../lib/queries";
import { RosterCard } from "../../../../../components/roster-card";
import { RangeTabs } from "../../../../../components/range-tabs";

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; group: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug, group: groupSlug } = await params;
  const { range: rangeParam } = await searchParams;
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
          <RangeTabs value={range} />
          <a href={`/team/${slug}/groups/${group.slug}/invite`} className="btn">+ Invite member</a>
        </div>
      </div>
      <div className="roster-grid">
        {roster.map((r) => <RosterCard key={r.id} member={r} teamSlug={slug} />)}
      </div>
    </>
  );
}
