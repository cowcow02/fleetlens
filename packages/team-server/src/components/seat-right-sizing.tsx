import { provenanceFor } from "../lib/metric-provenance";
import { ExplainBadge } from "./explain-badge";

export type SeatCandidate = {
  name: string;
  fromTier: string;
  toTier: string;
  avgPct: number;
  peakPct: number;
  savingsUsd: number;
};

// Seat right-sizing lens (Phase 1b). Walled off from the momentum/maturity
// report on purpose: it is a cost signal, not a performance one, and it is
// deliberately one-directional — only chronically LOW plan utilization is
// surfaced (a member who could move to a smaller seat). High usage is never
// flagged here, so the lens can't double as a productivity leaderboard.
export function SeatRightSizing({
  candidates,
  reviewedCount,
  insufficientCount,
  explain = false,
}: {
  candidates: SeatCandidate[];
  reviewedCount: number;
  insufficientCount: number;
  explain?: boolean;
}) {
  const totalSavings = candidates.reduce((s, c) => s + c.savingsUsd, 0);
  return (
    <section
      className="live-section"
      style={{ marginTop: 40, borderTop: "2px solid var(--rule)", paddingTop: 24 }}
    >
      <div className="subsection-head">
        <h2>
          <em>Seat right-sizing</em>
          {explain && <ExplainBadge p={provenanceFor("seat-right-sizing")} />}
        </h2>
        <span className="kicker">cost lens · not performance</span>
      </div>
      <p className="kicker" style={{ marginTop: 4, marginBottom: 14, maxWidth: 760, lineHeight: 1.5 }}>
        One-directional by design: only chronically <strong>low</strong> plan utilization is flagged —
        a seat that could move down a tier. High usage is never surfaced here, so this can&rsquo;t be
        read as a productivity ranking. Based on the trailing 30 days of plan-utilization snapshots.
      </p>
      {candidates.length === 0 ? (
        <p className="live-empty-row">
          {reviewedCount === 0
            ? insufficientCount > 0
              ? `Not enough plan-utilization history yet for the ${insufficientCount} ${insufficientCount === 1 ? "member" : "members"} in this group.`
              : "No plan-utilization data for this group yet."
            : `All ${reviewedCount} ${reviewedCount === 1 ? "seat is" : "seats are"} right-sized for current usage${insufficientCount > 0 ? ` · ${insufficientCount} need more observation days` : ""}.`}
        </p>
      ) : (
        <>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Current seat</th>
                <th>Suggested</th>
                <th>7-day usage (30d)</th>
                <th>Est. saving</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.name}>
                  <td className="proj-name">{c.name}</td>
                  <td className="muted">{c.fromTier}</td>
                  <td>→ {c.toTier}</td>
                  <td className="muted">{c.avgPct}% avg · {c.peakPct}% peak</td>
                  <td>${c.savingsUsd}/mo</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kicker" style={{ marginTop: 10 }}>
            {candidates.length} downgrade {candidates.length === 1 ? "candidate" : "candidates"} ·
            up to ${totalSavings}/mo if actioned. A manager decision, not an automatic change.
          </p>
        </>
      )}
    </section>
  );
}
