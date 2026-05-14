import type { TeamPulse, DayOutcome, DayHelpfulness } from "../app/team/[slug]/insights/types";

const OUTCOME_COLORS: Record<DayOutcome, string> = {
  shipped: "var(--positive)",
  partial: "var(--warning)",
  blocked: "var(--danger)",
  exploratory: "var(--mute)",
  trivial: "var(--rule)",
};

const HELPFULNESS_COLORS: Record<DayHelpfulness, string> = {
  essential: "var(--accent)",
  helpful: "var(--positive)",
  neutral: "var(--mute)",
  unhelpful: "var(--danger)",
};

const OUTCOME_ORDER: DayOutcome[] = ["shipped", "partial", "blocked", "exploratory", "trivial"];
const HELPFULNESS_ORDER: DayHelpfulness[] = ["essential", "helpful", "neutral", "unhelpful"];

function StackedBar({
  data,
  colors,
  order,
}: {
  data: Record<string, number>;
  colors: Record<string, string>;
  order: string[];
}) {
  const total = order.reduce((s, k) => s + (data[k] ?? 0), 0);
  if (total === 0) return null;
  return (
    <>
      <div className="stacked-bar">
        {order.map((k) => {
          const v = data[k] ?? 0;
          if (v === 0) return null;
          const pct = (v / total) * 100;
          return (
            <div
              key={k}
              className="stacked-bar-seg"
              style={{ width: `${pct}%`, background: colors[k] }}
              title={`${k}: ${v}`}
            />
          );
        })}
      </div>
      <div className="stacked-bar-legend">
        {order.map((k) => {
          const v = data[k] ?? 0;
          if (v === 0) return null;
          return (
            <span key={k}>
              <span className="stacked-bar-legend-swatch" style={{ background: colors[k] }} />
              {k} · {v}
            </span>
          );
        })}
      </div>
    </>
  );
}

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

        <div className="pulse-tile" style={{ gridColumn: "span 3" }}>
          <div className="pulse-tile-label">Outcome mix (across all session-days)</div>
          <StackedBar data={pulse.outcome_mix} colors={OUTCOME_COLORS} order={OUTCOME_ORDER} />
        </div>

        <div className="pulse-tile" style={{ gridColumn: "span 3" }}>
          <div className="pulse-tile-label">Helpfulness mix (member-day mode)</div>
          <StackedBar data={pulse.helpfulness_mix} colors={HELPFULNESS_COLORS} order={HELPFULNESS_ORDER} />
        </div>
      </div>
    </section>
  );
}
