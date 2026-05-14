import type { TeamPulse } from "../app/team/[slug]/insights/types";

function deltaLabel(pct: number, suffix = "%"): { text: string; cls: string } {
  if (pct === 0) return { text: `±0${suffix} vs last week`, cls: "" };
  if (pct > 0) return { text: `+${pct}${suffix} vs last week`, cls: "positive" };
  return { text: `${pct}${suffix} vs last week`, cls: "negative" };
}

function shippedDeltaLabel(count: number): { text: string; cls: string } {
  if (count === 0) return { text: "±0 vs last week", cls: "" };
  if (count > 0) return { text: `+${count} vs last week`, cls: "positive" };
  return { text: `${count} vs last week`, cls: "negative" };
}

export function TeamPulseSection({ pulse }: { pulse: TeamPulse }) {
  const hoursDelta = deltaLabel(pulse.agent_hours_wow_delta_pct);
  const shippedDelta = shippedDeltaLabel(pulse.shipped_wow_delta);

  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Team <em>pulse</em></h2>
        <div className="kicker">This week · agent fleet at a glance</div>
      </div>

      <div className="pulse-grid">
        <div className="pulse-tile">
          <div className="pulse-tile-label">Combined agent time</div>
          <div className="pulse-tile-value">
            {pulse.agent_hours.toFixed(1)}<span className="pulse-tile-suffix">h</span>
          </div>
          <div className={`pulse-tile-delta ${hoursDelta.cls}`}>{hoursDelta.text}</div>
        </div>

        <div className="pulse-tile">
          <div className="pulse-tile-label">Shipped</div>
          <div className="pulse-tile-value">
            {pulse.shipped_count}<span className="pulse-tile-suffix">PRs</span>
          </div>
          <div className={`pulse-tile-delta ${shippedDelta.cls}`}>{shippedDelta.text}</div>
        </div>

        <div className="pulse-tile">
          <div className="pulse-tile-label">Members active</div>
          <div className="pulse-tile-value">
            {pulse.members_active}<span className="pulse-tile-suffix"> of {pulse.members_total}</span>
          </div>
          <div className="pulse-tile-delta">
            Concurrency peak {pulse.concurrency_peak.peak}× on {pulse.concurrency_peak.date}
          </div>
        </div>
      </div>
    </section>
  );
}
