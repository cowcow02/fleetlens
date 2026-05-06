import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getPool } from "../../../db/pool";
import { validateSession } from "../../../lib/auth";
import { instanceState } from "../../../lib/server-config";
import { loadChangelog, latestVersion } from "../../../lib/changelog";
import { ChangelogNavLink } from "../../../components/changelog-nav-link";

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
          {state.allowMultipleTeams && <a href="/teams/new">+ New team</a>}
          <div className="shell-nav-label">Account</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)", padding: "4px 0 8px" }}>
            {session.user.email}
          </div>
          <a href={`/team/${slug}/me`}>My account · pair CLI</a>
          <a href="/logout">Sign out</a>
          <div className="shell-nav-label">About</div>
          <ChangelogNavLink latestVersion={latestVersion(loadChangelog())} />
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </>
  );
}
