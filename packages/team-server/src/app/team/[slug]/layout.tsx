import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { instanceState } from "../../../lib/server-config";
import { listGroupsManagedBy } from "../../../lib/groups";
import { NavFooter } from "../../../components/nav-footer";

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  const demo = process.env.FLEETLENS_FLUENCY_DEMO === "1";
  if (!session && !demo) redirect("/login");

  let team: { id: string; name: string; created_at: Date };
  let myMembership: { id: string; team_id: string; role: string } | null = null;
  if (session) {
    const teamRes = await pool.query("SELECT id, name, created_at FROM teams WHERE slug = $1", [slug]);
    if (!teamRes.rowCount) notFound();
    team = teamRes.rows[0];
    const m = session.memberships.find((mm) => mm.team_id === team.id);
    if (!m && !demo) redirect("/login");
    if (m) myMembership = { id: m.id, team_id: m.team_id, role: m.role };
  } else {
    // Demo path: synthesise a stub team + admin membership so the rest of the layout renders.
    team = { id: "demo-team", name: "Kipwise Engineering", created_at: new Date("2026-01-01") };
    myMembership = { id: "demo-member", team_id: team.id, role: "admin" };
  }

  let memberCountN = 8;
  let stateAllowMultipleTeams = false;
  let isStaff = false;
  let userEmail = "demo@kipwise.com";
  if (session) {
    const memberCount = await pool.query(
      "SELECT COUNT(*)::int AS n FROM memberships WHERE revoked_at IS NULL AND team_id = $1",
      [team.id]
    );
    memberCountN = memberCount.rows[0].n;
    const state = await instanceState(pool);
    stateAllowMultipleTeams = state.allowMultipleTeams;
    isStaff = session.user.is_staff;
    userEmail = session.user.email;
  }
  const created = new Date(team.created_at);
  const issueNum = String(Math.floor((Date.now() - created.getTime()) / (7 * 24 * 3600 * 1000)) + 1).padStart(2, "0");
  const isAdmin = myMembership!.role === "admin";
  const isAdminOrStaff = isAdmin || isStaff;
  const managedCount = isAdminOrStaff || !session ? 1 : (await listGroupsManagedBy(myMembership!.id, pool)).length;
  const showGroups = isAdminOrStaff || managedCount > 0;

  return (
    <>
      <header className="masthead">
        <div className="masthead-logo">Fleet<em>lens</em></div>
        <div className="masthead-meta">
          <span className="mono">VOL. I</span>
          <span className="dot">·</span>
          <span className="mono">ISS. {issueNum}</span>
          <span className="dot">·</span>
          <span className="mono">{team.name.toUpperCase()}</span>
          <span className="dot">·</span>
          <span className="mono">{memberCountN} ACTIVE</span>
        </div>
      </header>
      <div className="shell">
        <nav className="shell-nav">
          <div className="shell-nav-label">Team</div>
          {isAdmin ? (
            <a href={`/team/${slug}`}>Roster <span className="mono">01</span></a>
          ) : (
            <a href={`/team/${slug}/members/${myMembership!.id}`}>My profile <span className="mono">01</span></a>
          )}
          {isAdmin && <a href={`/team/${slug}/plan`}>Plan <span className="mono">02</span></a>}
          {showGroups && (
            <a href={`/team/${slug}/groups`}>Groups <span className="mono">{isAdmin ? "03" : "02"}</span></a>
          )}
          <a href={`/team/${slug}/fluency`}>
            Fluency <span className="mono">{isAdmin ? (showGroups ? "04" : "03") : (showGroups ? "03" : "02")}</span>
          </a>
          {isAdmin && <a href={`/team/${slug}/settings`}>Settings <span className="mono">05</span></a>}
          {stateAllowMultipleTeams && <a href="/teams/new">+ New team</a>}

          {isStaff && (
            <>
              <div className="shell-nav-label">Server admin</div>
              <a href="/admin/updates">Updates</a>
              <a href="/admin/staff">Staff</a>
            </>
          )}

          <div className="shell-nav-label">Account</div>
          <a href={`/team/${slug}/me`}>My account · pair CLI</a>

          <NavFooter email={userEmail} />
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </>
  );
}
