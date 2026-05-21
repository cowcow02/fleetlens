import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { listGroupsManagedBy } from "../../../lib/groups";
import {
  loadRoster,
  loadMemberGroupAffiliations,
  parseRange,
  RANGE_DAYS,
} from "../../../lib/queries";
import { RosterCard } from "../../../components/roster-card";
import { LiveRefresher } from "../../../components/live-refresher";
import { RangeTabs } from "../../../components/range-tabs";

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const days = RANGE_DAYS[range];
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

  const roster = await loadRoster(teamId, days, pool);
  const affiliations = await loadMemberGroupAffiliations(teamId, pool);
  const totalAgentMs = roster.reduce((sum, m) => sum + Number(m.range_agent_time_ms), 0);
  const totalHours = (totalAgentMs / 3600000).toFixed(1);

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Roster</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Last {days} days
            {" · "}
            {roster.length} {roster.length === 1 ? "member" : "members"}
            {" · "}
            {totalHours}h combined agent time
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <RangeTabs value={range} />
          <div className="kicker">Live · updates via SSE</div>
        </div>
      </div>
      <div className="roster-grid">
        {roster.map((m) => (
          <RosterCard
            key={m.id}
            member={m}
            teamSlug={slug}
            groups={affiliations.get(m.id) ?? []}
          />
        ))}
      </div>
      <footer className="page-footer">
        <span>Fleetlens · Team Edition</span>
        <span>{new Date().toISOString()}</span>
      </footer>
      <LiveRefresher teamSlug={slug} />
    </>
  );
}
