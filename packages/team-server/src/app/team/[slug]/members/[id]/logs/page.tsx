import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPool } from "../../../../../../db/pool";
import { validateSession } from "../../../../../../lib/auth";
import { loadMember } from "../../../../../../lib/queries";
import { loadMemberSyncLog, type MemberSyncLogRow } from "../../../../../../lib/plan-queries";
import { canSeeMember, loadManagedMemberIds } from "../../../../../../lib/visibility";

export const dynamic = "force-dynamic";

// Per-member sync log — renders the same per-push health events the daemon
// writes to server stdout, so admins can answer "is this member's sync
// healthy?" from the UI without shelling into the container. A row per
// meaningful push; "partial" = at least one data block was dropped.
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

  const rows = await loadMemberSyncLog(member.team_id, id, pool, 100);
  const name = member.display_name || member.email;
  const partialCount = rows.filter((r) => r.status === "partial").length;
  const lastPushMs = rows[0]?.createdAtMs ?? null;

  return (
    <main style={{ maxWidth: 940, margin: "0 auto", padding: "28px 24px 80px" }}>
      <div style={{ fontSize: 12, marginBottom: 18 }}>
        <a href={`/team/${slug}/members/${id}`} style={{ color: "var(--mute)", textDecoration: "none" }}>
          ← Back to {name}
        </a>
      </div>

      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Sync log</h1>
      <p style={{ color: "var(--mute)", fontSize: 13, margin: "0 0 4px", maxWidth: "64ch" }}>
        Every push {name}&rsquo;s daemon made to the team server, newest first. A{" "}
        <b style={{ color: "var(--positive)" }}>clean</b> push accepted all its data;{" "}
        <b style={{ color: "var(--warning)" }}>partial</b> means at least one block was dropped
        (the reason is shown). This mirrors the server ingest log so you don&rsquo;t need container access.
      </p>

      <div
        style={{
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          fontSize: 12,
          color: "var(--mute)",
          margin: "14px 0 18px",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
        }}
      >
        <span>{rows.length} push{rows.length === 1 ? "" : "es"} (last 100)</span>
        <span>
          last push ·{" "}
          <b style={{ color: lastPushMs == null ? "var(--mute)" : "var(--ink-soft)" }}>{relAge(lastPushMs)}</b>
        </span>
        <span>
          dropped-block pushes ·{" "}
          <b style={{ color: partialCount > 0 ? "var(--warning)" : "var(--positive)" }}>{partialCount}</b>
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
          No sync pushes recorded yet. Once this member&rsquo;s daemon syncs, its pushes appear here.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--rule)", borderRadius: 8 }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: 12.5,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: "var(--mute)", background: "var(--paper)" }}>
                <Th>When</Th>
                <Th>Status</Th>
                <Th>CLI</Th>
                <Th>Accepted</Th>
                <Th>Dropped</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ padding: "9px 12px", fontWeight: 600, borderBottom: "1px solid var(--rule)", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Row({ r }: { r: MemberSyncLogRow }) {
  const partial = r.status === "partial";
  const skippedEntries = Object.entries(r.skipped);
  return (
    <tr
      style={{
        borderBottom: "1px solid var(--rule-soft)",
        background: partial ? "var(--accent-soft)" : "transparent",
      }}
    >
      <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: "var(--ink-soft)" }} title={absTime(r.createdAtMs)}>
        {relAge(r.createdAtMs)}
      </td>
      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
        <span
          style={{
            fontWeight: 700,
            color: partial ? "var(--warning)" : "var(--positive)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            fontSize: 11,
          }}
        >
          {partial ? "partial" : "ok"}
        </span>
        {r.dedup && <span style={{ color: "var(--mute-soft)", marginLeft: 8, fontSize: 11 }}>replay</span>}
      </td>
      <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: "var(--mute)" }}>
        {r.cliVersion ? `v${r.cliVersion}` : "—"}
      </td>
      <td style={{ padding: "8px 12px", color: "var(--ink-soft)" }}>
        {r.accepted.length ? r.accepted.join(", ") : <span style={{ color: "var(--mute-soft)" }}>none</span>}
      </td>
      <td style={{ padding: "8px 12px", color: partial ? "var(--danger)" : "var(--mute-soft)" }}>
        {skippedEntries.length ? skippedEntries.map(([k]) => k).join(", ") : "—"}
      </td>
      <td style={{ padding: "8px 12px", color: "var(--mute)", maxWidth: 320 }}>
        {skippedEntries.length > 0
          ? skippedEntries.map(([, reason]) => reason).join(" · ")
          : r.histReceived > 0
            ? `usage snapshots ${r.histInserted}/${r.histReceived}`
            : ""}
      </td>
    </tr>
  );
}

function relAge(ms: number | null): string {
  if (ms == null) return "—";
  const age = Date.now() - ms;
  if (age < 0) return "just now";
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h ago`;
  return `${Math.round(age / 86_400_000)}d ago`;
}

function absTime(ms: number): string {
  return new Date(ms).toLocaleString();
}
