import type { HowTheyWorked } from "../app/team/[slug]/insights/types";

const GOAL_COLORS = [
  "var(--accent)",
  "var(--positive)",
  "var(--warning)",
  "var(--mute)",
  "var(--rule)",
  "var(--ink-soft)",
];

export function WorkingShapeDistributionSection({ data }: { data: HowTheyWorked }) {
  const maxOccurrences = Math.max(...data.shapes.map((s) => s.occurrences), 1);

  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>How the team <em>worked</em></h2>
        <div className="kicker">Working shapes · goal mix · adoption signals</div>
      </div>

      <div>
        {data.shapes.map((s) => {
          const widthPct = (s.occurrences / maxOccurrences) * 100;
          const dist = Object.entries(s.outcome_distribution)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
          return (
            <div key={s.shape} className="shape-row">
              <div className="shape-row-label">{s.shape}</div>
              <div className="shape-row-bar-track">
                <div className="shape-row-bar-fill" style={{ width: `${widthPct}%` }} />
              </div>
              <div className="shape-row-meta">
                ×{s.occurrences} · {s.members_using} member{s.members_using === 1 ? "" : "s"}
                {dist ? ` · ${dist}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 28 }}>
        <div className="harness-block-title">Goal-category minute mix</div>
        <div className="goal-mix-strip">
          {data.goal_categories.map((g, i) => (
            <div
              key={g.category}
              className="goal-mix-seg"
              style={{ width: `${g.share_pct}%`, background: GOAL_COLORS[i % GOAL_COLORS.length] }}
              title={`${g.category}: ${g.minutes} min (${g.share_pct}%)`}
            />
          ))}
        </div>
        <div className="goal-mix-legend">
          {data.goal_categories.map((g, i) => (
            <span key={g.category}>
              <span
                className="stacked-bar-legend-swatch"
                style={{ background: GOAL_COLORS[i % GOAL_COLORS.length] }}
              />
              {g.category} · {g.share_pct}%
            </span>
          ))}
        </div>
      </div>

      <div className="adoption-meta">
        <div>
          <strong>{data.plan_mode_adopters}</strong> member{data.plan_mode_adopters === 1 ? "" : "s"} used Plan Mode
        </div>
        <div>
          <strong>{data.brainstorm_warmup_adopters}</strong> opened a session with a brainstorming skill
        </div>
      </div>
    </section>
  );
}
