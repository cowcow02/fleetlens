import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadMember } from "../../../../../../lib/queries";
import { LogViewer } from "../../../../../../components/log-viewer";

export const dynamic = "force-dynamic";

// Per-member view of the raw server log, pre-filtered to this member's ingest
// lines (member=<id>). Staff-only, like the global /admin/logs — raw lines can
// carry any team's data, so this is a server-operator tool. The structured
// member_sync_log audit remains as durable background telemetry; this page is
// the actual line-by-line log for troubleshooting.
export default async function MemberLogsPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const pool = getPool();

  const token = (await cookies()).get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");
  if (!session.user.is_staff) notFound();

  const member = await loadMember(id, pool);
  if (!member) notFound();
  const name = member.display_name || member.email;

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 24px 80px" }}>
      <div style={{ fontSize: 12, marginBottom: 18 }}>
        <a href={`/team/${slug}/members/${id}`} style={{ color: "var(--mute)", textDecoration: "none" }}>
          ← Back to {name}
        </a>
      </div>

      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Sync log · {name}</h1>
      <p style={{ color: "var(--mute)", fontSize: 13, margin: "0 0 18px", maxWidth: "70ch" }}>
        The raw server log filtered to this member&rsquo;s ingest lines. Each sync pushes an{" "}
        <code>[ingest] push member={id.slice(0, 8)}…</code> line — clean pushes log at info,
        dropped blocks at warn. In-memory only: resets on restart.
      </p>

      <LogViewer initialQuery={`member=${id}`} />
    </main>
  );
}
