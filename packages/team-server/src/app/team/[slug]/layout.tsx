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
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name, created_at FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const team = teamRes.rows[0];

  const myMembership = session.memberships.find((m) => m.team_id === team.id);
  if (!myMembership) redirect("/login");

  const memberCount = await pool.query(
    "SELECT COUNT(*)::int AS n FROM memberships WHERE revoked_at IS NULL AND team_id = $1",
    [team.id]
  );
  const state = await instanceState(pool);
  const created = new Date(team.created_at);
  const issueNum = String(Math.floor((Date.now() - created.getTime()) / (7 * 24 * 3600 * 1000)) + 1).padStart(2, "0");
  const isAdmin = myMembership.role === "admin";
  const isAdminOrStaff = isAdmin || session.user.is_staff;
  const managedCount = isAdminOrStaff ? 1 : (await listGroupsManagedBy(myMembership.id, pool)).length;
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
          <span className="mono">{memberCount.rows[0].n} ACTIVE</span>
        </div>
      </header>
      <div className="shell">
        <nav className="shell-nav">
          <div className="shell-nav-label">Team</div>
          {isAdmin ? (
            <a href={`/team/${slug}`}>Roster <span className="mono">01</span></a>
          ) : (
            <a href={`/team/${slug}/members/${myMembership.id}`}>My profile <span className="mono">01</span></a>
          )}
          {isAdmin && <a href={`/team/${slug}/plan`}>Plan <span className="mono">02</span></a>}
          {isAdmin && <a href={`/team/${slug}/settings`}>Settings <span className="mono">03</span></a>}
          {showGroups && (
            <a href={`/team/${slug}/groups`}>Groups <span className="mono">{isAdmin ? "04" : "02"}</span></a>
          )}
          {state.allowMultipleTeams && <a href="/teams/new">+ New team</a>}

          {session.user.is_staff && (
            <>
              <div className="shell-nav-label">Server admin</div>
              <a href="/admin/updates">Updates</a>
              <a href="/admin/staff">Staff</a>
            </>
          )}

          <div className="shell-nav-label">Account</div>
          <a href={`/team/${slug}/me`}>My account · pair CLI</a>

          <NavFooter email={session.user.email} />
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </>
  );
}
