import { formatAgentTime, formatTokens, timeAgo } from "../lib/format.js";
import type { RosterRow } from "../lib/queries.js";

export function RosterCard({ member, teamSlug }: { member: RosterRow; teamSlug: string }) {
  return (
    <a href={`/team/${teamSlug}/members/${member.id}`}
       style={{
         display: "block",
         border: "1px solid #e5e7eb",
         borderRadius: 8,
         padding: 16,
         textDecoration: "none",
         color: "inherit",
       }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{member.display_name || member.email || "Anonymous"}</div>
          {member.email && member.display_name && (
            <div style={{ color: "#6b7280", fontSize: 13 }}>{member.email}</div>
          )}
        </div>
        <span style={{
          fontSize: 12,
          color: member.role === "admin" ? "#7c3aed" : "#6b7280",
          textTransform: "uppercase",
          fontWeight: 500,
        }}>
          {member.role}
        </span>
      </div>
      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
        Last seen: {timeAgo(member.last_seen_at)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 13 }}>
        <div>
          <div style={{ color: "#6b7280" }}>Agent time</div>
          <div style={{ fontWeight: 600 }}>{formatAgentTime(Number(member.week_agent_time_ms))}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280" }}>Sessions</div>
          <div style={{ fontWeight: 600 }}>{member.week_sessions}</div>
        </div>
        <div>
          <div style={{ color: "#6b7280" }}>Tokens</div>
          <div style={{ fontWeight: 600 }}>{formatTokens(Number(member.week_tokens))}</div>
        </div>
      </div>
    </a>
  );
}
