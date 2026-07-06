import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadMember } from "../../../../../../lib/queries";
import { loadMemberDaemonLog } from "../../../../../../lib/plan-queries";
import { canSeeMember, loadManagedMemberIds } from "../../../../../../lib/visibility";

export const dynamic = "force-dynamic";

// The member's OWN daemon sync log, uploaded from their machine via the metrics
// push — the client-side troubleshooting story (what the daemon tried,
// computed, the push results/errors). This is what actually helps diagnose
// "why isn't member X syncing?", not the server's view of what arrived.
// Persisted in Postgres, so it survives server reboots. Visible to anyone who
// can already see this member (team admins), not staff-only.
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

  const member = await loadMember(id, pool);
  if (!member) notFound();

  const myMembership = session.memberships.find((m) => m.team_id === member.team_id);
  if (!myMembership) redirect("/login");

  const viewer = { membershipId: myMembership.id, role: myMembership.role, isStaff: session.user.is_staff };
  const managed = await loadManagedMemberIds(viewer.membershipId, pool);
  if (!canSeeMember(viewer, id, managed)) notFound();

  const rows = await loadMemberDaemonLog(member.team_id, id, pool, 500);
  const name = member.display_name || member.email;
  const lastMs = rows.length ? rows[0].tsMs : null;

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "28px 24px 80px" }}>
      <div style={{ fontSize: 12, marginBottom: 18 }}>
        <a href={`/team/${slug}/members/${id}`} style={{ color: "var(--mute)", textDecoration: "none" }}>
          ← Back to {name}
        </a>
      </div>

      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Sync log · {name}</h1>
      <p style={{ color: "var(--mute)", fontSize: 13, margin: "0 0 18px", maxWidth: "72ch" }}>
        {name}&rsquo;s daemon uploads its own sync log from their machine on every push — what it
        tried, what it computed, and each push&rsquo;s result. Newest first. This is the
        client-side story, so it shows failures that never reached the server. Persisted, so it
        survives a server restart.
      </p>

      <div
        style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          fontSize: 12,
          color: "var(--mute)",
          margin: "0 0 16px",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
        }}
      >
        <span>{rows.length} line{rows.length === 1 ? "" : "s"} (last 500)</span>
        <span>
          latest ·{" "}
          <b style={{ color: lastMs == null ? "var(--mute)" : "var(--ink)" }}>{relAge(lastMs)}</b>
        </span>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--rule)",
            borderRadius: 8,
            padding: "28px 20px",
            textAlign: "center",
            color: "var(--mute)",
            fontSize: 13,
          }}
        >
          No daemon log uploaded yet. Once {name}&rsquo;s daemon syncs (within ~5 min of activity),
          its sync log appears here.
        </div>
      ) : (
        <div
          style={{
            background: "#14120e",
            border: "1px solid #000",
            borderRadius: 8,
            padding: "12px 14px",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 12,
            lineHeight: 1.6,
            overflowX: "auto",
          }}
        >
          {rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: "#6b665a", flex: "0 0 auto", userSelect: "none" }}>
                {new Date(r.tsMs).toISOString().slice(5, 19).replace("T", " ")}
              </span>
              <span style={{ color: lineColor(r.level), flex: "1 1 auto" }}>{r.msg}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function lineColor(level: string): string {
  if (level === "error") return "#f0857a";
  if (level === "warn") return "#e8b866";
  return "#cfc9b8";
}

function relAge(ms: number | null): string {
  if (ms == null) return "—";
  const age = Date.now() - ms;
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h ago`;
  return `${Math.round(age / 86_400_000)}d ago`;
}
