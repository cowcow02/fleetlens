import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { listGroupsForTeam } from "../../../../lib/groups";
import { getStatus } from "../../../../lib/self-update/service";
import { SettingsPanel } from "../../../../components/settings-panel";
import { IntegrationsPanel } from "../../../../components/integrations-panel";
import { ServerUpdatePanel } from "../../../../components/server-update-panel";

// Page-level tabs mirror the per-group settings modal so org and group
// configuration read as one system. Server tab appears for staff only.
const TABS = [
  { key: "profile", label: "Profile" },
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites & sign-up" },
  { key: "integrations", label: "Integrations" },
  { key: "server", label: "Server" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab: tabParam } = await searchParams;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query(
    "SELECT id, name, slug, retention_days, custom_domain, allowed_signup_domains, created_at FROM teams WHERE slug = $1",
    [slug],
  );
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const team = teamRes.rows[0];

  const m = session.memberships.find((x) => x.team_id === team.id);
  if (!m) redirect("/login");
  if (m.role !== "admin") {
    return (
      <div className="section-head">
        <div>
          <h1>Admin <em>only</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>Settings are visible to admins only.</div>
        </div>
      </div>
    );
  }

  const [members, updateStatus, groups] = await Promise.all([
    pool.query(
      `SELECT m.id, u.email, u.display_name, m.role, m.joined_at, m.last_seen_at, m.revoked_at, m.plan_tier
       FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
       WHERE m.team_id = $1 ORDER BY m.joined_at`,
      [team.id]
    ),
    session.user.is_staff ? getStatus() : Promise.resolve(null),
    listGroupsForTeam(team.id, pool),
  ]);

  const visibleTabs = TABS.filter((t) => t.key !== "server" || updateStatus !== null);
  const tab: TabKey = visibleTabs.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "profile";

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Settings</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Team configuration · {members.rows.filter((mm) => !mm.revoked_at).length} active members
          </div>
        </div>
      </div>
      <nav className="group-settings-tabs settings-page-tabs" aria-label="Settings sections">
        {visibleTabs.map((t) => (
          <a
            key={t.key}
            className={`group-settings-tab ${tab === t.key ? "active" : ""}`}
            href={`/team/${slug}/settings${t.key === "profile" ? "" : `?tab=${t.key}`}`}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === "server" && updateStatus && <ServerUpdatePanel status={updateStatus} />}
      {(tab === "profile" || tab === "members" || tab === "invites") && (
        <SettingsPanel
          team={team}
          members={members.rows}
          teamSlug={slug}
          groups={groups}
          allowedSignupDomains={team.allowed_signup_domains ?? []}
          section={tab}
        />
      )}
      {tab === "integrations" && <IntegrationsPanel teamSlug={slug} groups={groups} />}
    </>
  );
}
