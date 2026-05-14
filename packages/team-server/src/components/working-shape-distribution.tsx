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
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>How time was <em>spent</em></h2>
        <div className="kicker">Goal-category mix · structured-thinking adoption</div>
      </div>

      <div>
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
