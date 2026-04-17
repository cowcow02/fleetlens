import { formatAgentTime, formatTokens } from "../lib/format";
import type { MemberRow, RollupRow } from "../lib/queries";

export function MemberProfile({ member, rollups }: { member: MemberRow; rollups: RollupRow[] }) {
  const totalAgentTime = rollups.reduce((sum, r) => sum + Number(r.agent_time_ms), 0);
  const totalSessions = rollups.reduce((sum, r) => sum + r.sessions, 0);
  const totalTokens = rollups.reduce(
    (sum, r) => sum + Number(r.tokens_input) + Number(r.tokens_output) + Number(r.tokens_cache_read) + Number(r.tokens_cache_write),
    0,
  );
  const maxDayMs = Math.max(...rollups.map((r) => Number(r.agent_time_ms)), 1);

  return (
    <>
      <div className="profile-head">
        <div>
          <h1 className="profile-name">
            <em>{member.display_name || member.email || "Anonymous"}</em>
          </h1>
          {member.email && (
            <div className="mono" style={{ marginTop: 8, fontSize: 12, color: "var(--mute)" }}>
              {member.email}
            </div>
          )}
        </div>
        <div className="profile-meta">
          {member.role.toUpperCase()}
          <br />
          JOINED {new Date(member.joined_at).toLocaleDateString("en-US", {
            month: "short", day: "2-digit", year: "numeric"
          }).toUpperCase()}
        </div>
      </div>

      <div className="stat-row">
        <div>
          <div className="stat-label">30-day Agent Time</div>
          <div className="stat-value">{formatAgentTime(totalAgentTime)}</div>
        </div>
        <div>
          <div className="stat-label">30-day Sessions</div>
          <div className="stat-value">{totalSessions}</div>
        </div>
        <div>
          <div className="stat-label">30-day Tokens</div>
          <div className="stat-value">{formatTokens(totalTokens)}</div>
        </div>
      </div>

      <div className="subsection-head">
        <h2>Daily activity</h2>
        <span className="kicker">30-day trail</span>
      </div>
      <div className="activity-chart">
        {rollups.length === 0 && (
          <div style={{ color: "var(--mute)", fontSize: 13, width: "100%", textAlign: "center", padding: 40 }}>
            No activity recorded in this window.
          </div>
        )}
        {rollups.map((r) => {
          const ms = Number(r.agent_time_ms);
          const height = Math.max(2, (ms / maxDayMs) * 100);
          return (
            <div
              key={r.day}
              className={`activity-bar ${ms === 0 ? "zero" : ""}`}
              style={{ height: `${height}%` }}
              title={`${r.day}: ${formatAgentTime(ms)}`}
            />
          );
        })}
      </div>
      {rollups.length > 0 && (
        <div className="activity-axis">
          <span>{rollups[0].day}</span>
          <span>{rollups[rollups.length - 1].day}</span>
        </div>
      )}

      <div className="subsection-head">
        <h2>Daily breakdown</h2>
        <span className="kicker">Newest first</span>
      </div>
      {rollups.length === 0 ? (
        <div style={{ color: "var(--mute)", fontSize: 13, padding: "24px 0" }}>No data.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Day</th>
              <th>Agent</th>
              <th>Sessions</th>
              <th>Tool calls</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {rollups.slice().reverse().map((r) => (
              <tr key={r.day}>
                <td>{r.day}</td>
                <td>{formatAgentTime(Number(r.agent_time_ms))}</td>
                <td>{r.sessions}</td>
                <td>{r.tool_calls}</td>
                <td>{formatTokens(Number(r.tokens_input) + Number(r.tokens_output) + Number(r.tokens_cache_read) + Number(r.tokens_cache_write))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
