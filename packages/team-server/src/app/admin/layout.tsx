import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../db/pool";
import { validateSession } from "../../lib/auth";
import { LATEST_VERSION as LATEST_CHANGELOG_VERSION } from "../../lib/changelog";
import { ChangelogNavLink } from "../../components/changelog-nav-link";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");
  if (!session.user.is_staff) redirect("/login");

  const primaryMembership = session.memberships[0];
  let primaryTeamSlug: string | null = null;
  if (primaryMembership) {
    const r = await pool.query("SELECT slug FROM teams WHERE id = $1", [primaryMembership.team_id]);
    primaryTeamSlug = r.rowCount ? r.rows[0].slug : null;
  }

  return (
    <>
      <header className="masthead">
        <div className="masthead-logo">Fleet<em>lens</em></div>
        <div className="masthead-meta">
          <span className="mono">SERVER ADMIN</span>
        </div>
      </header>
      <div className="shell">
        <nav className="shell-nav">
          {primaryTeamSlug && (
            <>
              <div className="shell-nav-label">Team</div>
              <a href={`/team/${primaryTeamSlug}`}>← Back to team</a>
            </>
          )}
          <div className="shell-nav-label">Account</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--mute)", padding: "4px 0 8px" }}>
            {session.user.email}
          </div>
          <a href="/logout">Sign out</a>
          <div className="shell-nav-label">Server admin</div>
          <a href="/admin/updates">Updates</a>
          <a href="/admin/staff">Staff</a>
          <div className="shell-nav-label">About</div>
          <ChangelogNavLink latestVersion={LATEST_CHANGELOG_VERSION} />
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </>
  );
}
