import { formatAgentTime, formatTokens } from "../lib/format.js";
import type { MemberRow, RollupRow } from "../lib/queries.js";

export function MemberProfile({ member, rollups }: { member: MemberRow; rollups: RollupRow[] }) {
  const totalAgentTime = rollups.reduce((sum, r) => sum + Number(r.agent_time_ms), 0);
  const totalSessions = rollups.reduce((sum, r) => sum + r.sessions, 0);
  const totalTokens = rollups.reduce((sum, r) => sum + Number(r.tokens_input) + Number(r.tokens_output), 0);
  const maxDayMs = Math.max(...rollups.map((r) => Number(r.agent_time_ms)), 1);

  return (
    <div style={{ marginTop: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>
        {member.display_name || member.email || "Anonymous"}
      </h1>
      {member.email && <div style={{ color: "#6b7280" }}>{member.email}</div>}
      <div style={{ color: "#6b7280", fontSize: 14, marginTop: 4 }}>
        {member.role} · Joined {new Date(member.joined_at).toLocaleDateString()}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 24 }}>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>30-day Agent Time</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatAgentTime(totalAgentTime)}</div>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>30-day Sessions</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{totalSessions}</div>
        </div>
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>30-day Tokens</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{formatTokens(totalTokens)}</div>
        </div>
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>Daily Activity</h2>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 120 }}>
        {rollups.map((r) => {
          const height = Math.max(2, (Number(r.agent_time_ms) / maxDayMs) * 100);
          return (
            <div key={r.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "100%",
                height: `${height}%`,
                backgroundColor: "#3b82f6",
                borderRadius: 2,
                minHeight: 2,
              }} title={`${r.day}: ${formatAgentTime(Number(r.agent_time_ms))}`} />
            </div>
          );
        })}
      </div>
      {rollups.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
          <span>{rollups[0].day}</span>
          <span>{rollups[rollups.length - 1].day}</span>
        </div>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>Daily Breakdown</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ textAlign: "left", padding: 8 }}>Day</th>
            <th style={{ textAlign: "right", padding: 8 }}>Agent Time</th>
            <th style={{ textAlign: "right", padding: 8 }}>Sessions</th>
            <th style={{ textAlign: "right", padding: 8 }}>Tool Calls</th>
            <th style={{ textAlign: "right", padding: 8 }}>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {rollups.slice().reverse().map((r) => (
            <tr key={r.day} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: 8 }}>{r.day}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{formatAgentTime(Number(r.agent_time_ms))}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{r.sessions}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{r.tool_calls}</td>
              <td style={{ padding: 8, textAlign: "right" }}>{formatTokens(Number(r.tokens_input) + Number(r.tokens_output))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
