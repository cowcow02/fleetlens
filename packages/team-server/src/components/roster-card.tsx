import { formatAgentTime, formatTokens, timeAgo } from "../lib/format";
import type { RosterRow, GroupAffiliation } from "../lib/queries";

export function RosterCard({
  member,
  teamSlug,
  groups = [],
}: {
  member: RosterRow;
  teamSlug: string;
  groups?: GroupAffiliation[];
}) {
  const lastSeenMs = member.last_seen_at ? Date.now() - new Date(member.last_seen_at).getTime() : Infinity;
  const isActive = lastSeenMs < 15 * 60 * 1000;

  return (
    <a href={`/team/${teamSlug}/members/${member.id}`} className="roster-card">
      <div className="roster-card-chevron">→</div>
      <div className="roster-card-head">
        <div>
          <div className="roster-card-name">{member.display_name || member.email || "Anonymous"}</div>
          {member.email && member.display_name && (
            <div className="roster-card-email">{member.email}</div>
          )}
          {groups.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
              {groups.slice(0, 2).map((g) => (
                <span
                  key={g.groupId}
                  title={g.isManager ? `${g.name} (manager)` : g.name}
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    letterSpacing: "0.04em",
                    padding: "2px 6px",
                    border: "1px solid var(--rule)",
                    borderRadius: 2,
                    color: "var(--mute)",
                    background: "var(--bg)",
                  }}
                >
                  {g.name}
                  {g.isManager && <span style={{ marginLeft: 4, color: "var(--accent)" }}>★</span>}
                </span>
              ))}
              {groups.length > 2 && (
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    letterSpacing: "0.04em",
                    color: "var(--mute)",
                    padding: "2px 4px",
                  }}
                >
                  +{groups.length - 2}
                </span>
              )}
            </div>
          )}
          <div className={`roster-card-lastseen ${isActive ? "active" : ""}`} style={{ marginTop: 10 }}>
            {timeAgo(member.last_seen_at).toLowerCase()}
          </div>
          <div
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10,
              letterSpacing: "0.04em",
              color: "var(--mute)",
              marginTop: 4,
            }}
            title="Installed Fleetlens CLI version"
          >
            {member.cli_version ? `CLI v${member.cli_version}` : "CLI —"}
          </div>
        </div>
        <span className={`roster-card-role ${member.role === "admin" ? "admin" : ""}`}>
          {member.role}
        </span>
      </div>

      <div className="roster-card-stats">
        <div className="roster-card-stat">
          <span className="roster-card-stat-label">Agent</span>
          <span className="roster-card-stat-value">{formatAgentTime(Number(member.range_agent_time_ms))}</span>
        </div>
        <div className="roster-card-stat">
          <span className="roster-card-stat-label">Sessions</span>
          <span className="roster-card-stat-value">{member.range_sessions}</span>
        </div>
        <div className="roster-card-stat">
          <span className="roster-card-stat-label">Tokens</span>
          <span className="roster-card-stat-value">{formatTokens(Number(member.range_tokens))}</span>
        </div>
      </div>
    </a>
  );
}
