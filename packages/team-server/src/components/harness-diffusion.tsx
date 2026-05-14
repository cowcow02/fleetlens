import type { Harness } from "../app/team/[slug]/insights/types";

export function HarnessDiffusionSection({ data }: { data: Harness }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Tools, skills, and <em>harness</em></h2>
        <div className="kicker">What the team built around the agent fleet this week</div>
      </div>

      <div className="harness-grid">
        <div>
          <div className="harness-block-title">Top tool families</div>
          {data.tool_families.map((t) => (
            <div key={t.family} className="harness-row">
              <span className="harness-row-name">{t.family}</span>
              <span className="harness-row-meta">×{t.uses}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="harness-block-title">User-authored skills</div>
          {data.user_skills.map((s) => (
            <div key={s.name} className="harness-row">
              <span className="harness-row-name">{s.name}</span>
              <span className="harness-row-meta">
                {s.members_using} member{s.members_using === 1 ? "" : "s"} · ×{s.total_uses}
              </span>
            </div>
          ))}
        </div>

        <div>
          <div className="harness-block-title">User-authored subagents</div>
          {data.user_subagents.map((s) => (
            <div key={s.name} className="harness-row">
              <span className="harness-row-name">{s.name}</span>
              <span className="harness-row-meta">
                {s.members_using} member{s.members_using === 1 ? "" : "s"} · ×{s.total_uses}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
