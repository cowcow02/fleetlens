import { cookies } from "next/headers";
import { getPool } from "../../../db/pool.js";
import { validateAdminSession } from "../../../lib/auth.js";
import { loadRoster } from "../../../lib/queries.js";
import { RosterCard } from "../../../components/roster-card.js";
import { LiveRefresher } from "../../../components/live-refresher.js";

export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("fleetlens_session")?.value;
  if (!cookieToken) return <div>Unauthorized. Please claim or log in.</div>;

  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return <div>Session expired. Please log in again.</div>;

  const teamRes = await pool.query("SELECT id FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;

  const roster = await loadRoster(teamRes.rows[0].id, pool);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Team Roster</h1>
        <span style={{ color: "#6b7280" }}>{roster.length} members</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {roster.map((m) => <RosterCard key={m.id} member={m} teamSlug={slug} />)}
      </div>
      <LiveRefresher />
    </div>
  );
}
