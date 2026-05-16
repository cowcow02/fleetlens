import type {
  ProjectTimeRow,
  SkillUsageRow,
  TeamPulseBlockData,
  WorkingShapeRow,
} from "../lib/insights-aggregate";

export type LiveInsightsData = {
  scopeLabel: string;
  weekMonday: string;
  pulse: TeamPulseBlockData;
  projects: ProjectTimeRow[];
  skills: SkillUsageRow[];
  shapes: WorkingShapeRow[];
};

function fmt(n: number, digits = 1): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function delta(current: number, prev: number): { label: string; tone: "up" | "down" | "flat" } {
  if (prev === 0 && current === 0) return { label: "—", tone: "flat" };
  if (prev === 0) return { label: "new", tone: "up" };
  const pct = ((current - prev) / prev) * 100;
  if (Math.abs(pct) < 1) return { label: "flat", tone: "flat" };
  const sign = pct > 0 ? "+" : "";
  const tone = pct > 0 ? "up" : "down";
  return { label: `${sign}${pct.toFixed(0)}%`, tone };
}

function shapeLabel(shape: string): string {
  return shape.replace(/-/g, " ");
}

export function LiveInsights({ data }: { data: LiveInsightsData }) {
  const { scopeLabel, weekMonday, pulse, projects, skills, shapes } = data;
  const weekStart = new Date(`${weekMonday}T12:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" });

  const hoursDelta = delta(pulse.agentHours, pulse.agentHoursPrev);
  const sessionsDelta = delta(pulse.sessions, pulse.sessionsPrev);
  const prsDelta = delta(pulse.prs, pulse.prsPrev);

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Insight Report</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Week of {fmtDate(weekStart).toUpperCase()} — {fmtDate(weekEnd).toUpperCase()}
            {" · "}
            {scopeLabel.toUpperCase()}
            {" · "}
            {pulse.membersActive} active
          </div>
        </div>
        <div className="kicker">
          Phase 1 · live data
        </div>
      </div>

      {pulse.membersActive === 0 ? (
        <div className="live-empty">
          <h2>No rich rollups yet for this week</h2>
          <p>
            Members in this scope haven&rsquo;t pushed Entry-derived rollups for the
            current week. The daemon publishes rich rollups automatically once the
            perception sweep has built Entries; running <code>fleetlens team push</code>{" "}
            from a paired member forces an immediate sync.
          </p>
        </div>
      ) : (
        <>
          <section className="live-section">
            <div className="subsection-head">
              <h2>Team <em>pulse</em></h2>
              <span className="kicker">v week-over-week</span>
            </div>
            <div className="live-stat-row">
              <Stat label="Agent hours" value={`${fmt(pulse.agentHours)}h`} sub={`vs ${fmt(pulse.agentHoursPrev)}h`} delta={hoursDelta} />
              <Stat label="Sessions" value={fmt(pulse.sessions, 0)} sub={`vs ${fmt(pulse.sessionsPrev, 0)}`} delta={sessionsDelta} />
              <Stat label="PRs shipped" value={fmt(pulse.prs, 0)} sub={`vs ${fmt(pulse.prsPrev, 0)}`} delta={prsDelta} />
              <Stat label="Concurrency peak" value={`×${pulse.concurrencyPeak}`} sub={`${fmt(pulse.parallelHours)}h parallel`} />
            </div>
          </section>

          <section className="live-section">
            <div className="subsection-head">
              <h2>Per-<em>project</em> time</h2>
              <span className="kicker">this week vs last</span>
            </div>
            {projects.length === 0 ? (
              <p className="live-empty-row">No project breakdown in window.</p>
            ) : (
              <div className="live-bars">
                {projects.slice(0, 10).map((p) => {
                  const max = projects[0]?.agentHours || 1;
                  const pct = Math.max(2, (p.agentHours / max) * 100);
                  const prevPct = Math.max(0, Math.min(100, (p.agentHoursPrev / max) * 100));
                  const d = delta(p.agentHours, p.agentHoursPrev);
                  return (
                    <div key={p.project} className="live-bar-row">
                      <div className="live-bar-label" title={p.project}>{p.project}</div>
                      <div className="live-bar-track">
                        <div className="live-bar-prev" style={{ width: `${prevPct}%` }} />
                        <div className="live-bar-cur" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="live-bar-value">
                        {fmt(p.agentHours)}h <span className={`live-delta ${d.tone}`}>{d.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="live-section">
            <div className="subsection-head">
              <h2><em>Working</em> shapes</h2>
              <span className="kicker">distribution this week</span>
            </div>
            {shapes.length === 0 ? (
              <p className="live-empty-row">No shape signals yet — the perception sweep hasn&rsquo;t classified sessions in this window.</p>
            ) : (
              <div className="live-bars">
                {shapes.map((s) => {
                  const max = shapes[0]?.sessions || 1;
                  const pct = Math.max(2, (s.sessions / max) * 100);
                  return (
                    <div key={s.shape} className="live-bar-row">
                      <div className="live-bar-label">{shapeLabel(s.shape)}</div>
                      <div className="live-bar-track">
                        <div className="live-bar-cur" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="live-bar-value">{s.sessions} · {fmt(s.agentHours)}h</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="live-section">
            <div className="subsection-head">
              <h2><em>Skill</em> usage</h2>
              <span className="kicker">top 12 · with WoW</span>
            </div>
            {skills.length === 0 ? (
              <p className="live-empty-row">No skill loads recorded in this window.</p>
            ) : (
              <div className="live-bars">
                {skills.slice(0, 12).map((s) => {
                  const max = skills[0]?.sessions || 1;
                  const pct = Math.max(2, (s.sessions / max) * 100);
                  const d = delta(s.sessions, s.sessionsPrev);
                  return (
                    <div key={s.skill} className="live-bar-row">
                      <div className="live-bar-label" title={s.skill}>{s.skill}</div>
                      <div className="live-bar-track">
                        <div className="live-bar-cur" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="live-bar-value">
                        {s.sessions} <span className={`live-delta ${d.tone}`}>{d.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="live-footnote">
            <strong>Phase 1 coverage</strong> — four blocks above are backed by{" "}
            <code>rich_daily_rollups</code>. Other catalog blocks (case studies,
            DORA, ticket flow, member fingerprints) require Phase-2 per-session
            detail or external integrations and remain mock-only on the{" "}
            <a href="?v=7">block-builder reference</a>.
          </section>
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  delta: d,
}: {
  label: string;
  value: string;
  sub: string;
  delta?: { label: string; tone: "up" | "down" | "flat" };
}) {
  return (
    <div className="live-stat">
      <div className="live-stat-label">{label}</div>
      <div className="live-stat-value">
        {value}
        {d ? <span className={`live-delta ${d.tone}`}>{d.label}</span> : null}
      </div>
      <div className="live-stat-sub">{sub}</div>
    </div>
  );
}
