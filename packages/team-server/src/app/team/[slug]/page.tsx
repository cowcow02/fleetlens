import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { listGroupsManagedBy } from "../../../lib/groups";
import { loadRoster } from "../../../lib/queries";
import { RosterCard } from "../../../components/roster-card";
import { LiveRefresher } from "../../../components/live-refresher";

export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;
  const myMembership = session.memberships.find((m) => m.team_id === teamId);
  if (!myMembership) redirect("/login");

  if (myMembership.role !== "admin" && !session.user.is_staff) {
    const managed = await listGroupsManagedBy(myMembership.id, pool);
    if (managed.length === 1) {
      redirect(`/team/${slug}/groups/${managed[0].slug}`);
    }
    if (managed.length > 1) {
      redirect(`/team/${slug}/groups`);
    }
    // 0 managed groups → plain member → see only self.
    redirect(`/team/${slug}/members/${myMembership.id}`);
  }

  const roster = await loadRoster(teamId, pool);
  const totalAgentMs = roster.reduce((sum, m) => sum + Number(m.week_agent_time_ms), 0);
  const totalHours = (totalAgentMs / 3600000).toFixed(1);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Roster</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Week of {weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase()}
            {" · "}
            {roster.length} {roster.length === 1 ? "member" : "members"}
            {" · "}
            {totalHours}h combined agent time
          </div>
        </div>
        <div className="kicker">Live · updates via SSE</div>
      </div>
      <div className="roster-grid">
        {roster.map((m) => <RosterCard key={m.id} member={m} teamSlug={slug} />)}
      </div>
      <footer className="page-footer">
        <span>Fleetlens · Team Edition</span>
        <span>{new Date().toISOString()}</span>
      </footer>
      <LiveRefresher teamSlug={slug} />
    </>
  );
}
