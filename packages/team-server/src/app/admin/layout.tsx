import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../db/pool";
import { validateSession } from "../../lib/auth";
import { NavFooter } from "../../components/nav-footer";

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

          <div className="shell-nav-label">Server admin</div>
          <a href="/admin/updates">Updates</a>
          <a href="/admin/staff">Staff</a>

          <NavFooter email={session.user.email} />
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </>
  );
}
