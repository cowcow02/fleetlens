import type { RosterRow } from "../app/team/[slug]/insights/types";

export function RosterSnapshotSection({
  roster,
  teamSlug,
}: {
  roster: RosterRow[];
  teamSlug: string;
}) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Roster <em>snapshot</em></h2>
        <div className="kicker">For 1:1 prep, drill into a member&apos;s detail page</div>
      </div>

      <table className="roster-mini-table">
        <tbody>
          {roster.map((r) => (
            <tr key={r.membership_id}>
              <td className="roster-mini-name">{r.display_name}</td>
              <td className="roster-mini-stats">
                {r.agent_hours.toFixed(1)}h · {r.shipped_count} PR{r.shipped_count === 1 ? "" : "s"} shipped
              </td>
              <td className="roster-mini-link">
                <a href={`/team/${teamSlug}/members/${r.membership_id}`}>open member detail →</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
