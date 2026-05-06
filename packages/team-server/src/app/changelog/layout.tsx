import { cookies } from "next/headers";
import { getPool } from "../../db/pool";
import { validateSession } from "../../lib/auth";
import { NavFooter } from "../../components/nav-footer";

export const dynamic = "force-dynamic";

export default async function ChangelogLayout({ children }: { children: React.ReactNode }) {
  const pool = getPool();
  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;

  // Allow anonymous access — the changelog is public-ish. Render the bare
  // content under the root layout if no session, the full shell otherwise.
  if (!session) return <>{children}</>;

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
          <span className="mono">CHANGELOG</span>
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

          {session.user.is_staff && (
            <>
              <div className="shell-nav-label">Server admin</div>
              <a href="/admin/updates">Updates</a>
              <a href="/admin/staff">Staff</a>
            </>
          )}

          {primaryTeamSlug && (
            <>
              <div className="shell-nav-label">Account</div>
              <a href={`/team/${primaryTeamSlug}/me`}>My account · pair CLI</a>
            </>
          )}

          <NavFooter email={session.user.email} />
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </>
  );
}
