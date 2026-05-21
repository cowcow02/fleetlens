"use client";

import type {
  TeamInsightReport,
  CaseStudy,
  CaseStudyPin,
  CaseStudyPinKind,
} from "../../app/team/[slug]/insights/types";

const PIN_COLORS: Record<CaseStudyPinKind, string> = {
  "user-steering": "var(--accent)",
  "subagent-burst": "#6b3aa3",
  "long-autonomous": "var(--positive)",
  "plan-mode": "#2a6f97",
  "pr-ship": "var(--positive)",
  "harness-chain": "#7b3aa3",
  interrupt: "var(--warning)",
  "brainstorm-loop": "#3a7ea3",
  "skill-load": "var(--accent)",
};

const PIN_LABEL: Record<CaseStudyPinKind, string> = {
  "user-steering": "USER",
  "subagent-burst": "SUBAGENT",
  "long-autonomous": "LONG-AUTO",
  "plan-mode": "PLAN",
  "pr-ship": "SHIP",
  "harness-chain": "HARNESS",
  interrupt: "INTERRUPT",
  "brainstorm-loop": "BRAINSTORM",
  "skill-load": "SKILL",
};

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function deltaTag(deltaPct?: number, deltaAbs?: number, unit = ""): { text: string; cls: string } {
  if (deltaPct !== undefined) {
    if (deltaPct === 0) return { text: `±0% vs last wk`, cls: "" };
    const sign = deltaPct > 0 ? "+" : "";
    return { text: `${sign}${deltaPct}% vs last wk`, cls: deltaPct > 0 ? "positive" : "negative" };
  }
  if (deltaAbs !== undefined) {
    if (deltaAbs === 0) return { text: `±0${unit} vs last wk`, cls: "" };
    const sign = deltaAbs > 0 ? "+" : "";
    return { text: `${sign}${deltaAbs}${unit} vs last wk`, cls: deltaAbs > 0 ? "positive" : "negative" };
  }
  return { text: "", cls: "" };
}

function CasePinDot({
  pin,
  duration,
}: {
  pin: CaseStudyPin;
  duration: number;
}) {
  const left = Math.max(0, Math.min(100, (pin.start_min / duration) * 100));
  const right = pin.end_min !== undefined
    ? Math.max(left + 0.5, Math.min(100, (pin.end_min / duration) * 100))
    : left;
  const isSpan = pin.end_min !== undefined && right > left + 0.5;
  const color = PIN_COLORS[pin.kind] ?? "var(--accent)";
  return (
    <>
      {isSpan && (
        <div
          className="cs-pin-span"
          style={{
            left: `${left}%`,
            width: `${right - left}%`,
            background: `color-mix(in srgb, ${color} 30%, transparent)`,
            border: `1px solid ${color}`,
          }}
          title={`${PIN_LABEL[pin.kind]}: ${pin.label}`}
        />
      )}
      <div
        className="cs-pin-marker"
        style={{ left: `${left}%`, background: color }}
        title={`${PIN_LABEL[pin.kind]}: ${pin.label}`}
      />
    </>
  );
}

function CaseTimelineMinimap({ session }: { session: CaseStudy }) {
  const observedMax = session.timeline.active_intervals.length > 0
    ? Math.max(...session.timeline.active_intervals.map((iv) => iv.end_min))
    : 0;
  const duration = Math.max(1, session.timeline.duration_min, observedMax);
  return (
    <div className="cs-minimap-wrap">
      <div className="cs-minimap-bar">
        {session.timeline.active_intervals.map((iv, i) => {
          const left = (iv.start_min / duration) * 100;
          const width = Math.max(0.6, ((iv.end_min - iv.start_min) / duration) * 100);
          return (
            <div
              key={i}
              className="cs-active-interval"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`active ${fmtMin(iv.start_min)} – ${fmtMin(iv.end_min)}`}
            />
          );
        })}
        {session.timeline.pins.map((pin, i) => (
          <CasePinDot key={i} pin={pin} duration={duration} />
        ))}
      </div>
      <div className="cs-minimap-ruler">
        <span>0m</span>
        <span>{fmtMin(duration / 4)}</span>
        <span>{fmtMin(duration / 2)}</span>
        <span>{fmtMin((duration * 3) / 4)}</span>
        <span>{fmtMin(duration)} wall</span>
      </div>
    </div>
  );
}

function CasePinList({ pins }: { pins: CaseStudyPin[] }) {
  return (
    <ol className="cs-pin-list">
      {pins.map((pin, i) => {
        const isSpan = pin.end_min !== undefined && pin.end_min > pin.start_min + 0.5;
        const t = isSpan ? `${fmtMin(pin.start_min)}–${fmtMin(pin.end_min!)}` : fmtMin(pin.start_min);
        const color = PIN_COLORS[pin.kind] ?? "var(--accent)";
        return (
          <li key={i}>
            <span className="cs-pin-time">{t}</span>
            <span className="cs-pin-tag" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
              {PIN_LABEL[pin.kind]}
            </span>
            <span className="cs-pin-label">{pin.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

const INTERACTION_TYPE_LABEL: Record<string, string> = {
  directive: "Directive",
  "feedback-loop": "Feedback loop",
  "task-iteration": "Task iteration",
  validation: "Validation",
  learning: "Learning",
};

export function CaseStudyCard({ cs }: { cs: CaseStudy }) {
  const d = cs.drill_observations;
  return (
    <article className="case-study-card">
      <header className="cs-head">
        <div style={{ flex: 1 }}>
          <div className="cs-author">{cs.author}</div>
          <h3 className="cs-title">{cs.day_signature}</h3>
          <div className="cs-meta">
            {cs.date} · {cs.project} · {fmtMin(cs.duration.wall_min)} wall · {fmtMin(cs.duration.active_min)} active ·{" "}
            {cs.turn_count} turns · {cs.outcome}
          </div>
          {(cs.interaction_type || cs.complexity) && (
            <div className="cs-classification">
              {cs.interaction_type && (
                <span className={`cs-interaction-pill type-${cs.interaction_type}`}>
                  {INTERACTION_TYPE_LABEL[cs.interaction_type] ?? cs.interaction_type}
                </span>
              )}
              {cs.complexity && (
                <span className="cs-complexity-pill" title={`Complexity ${cs.complexity}/5`}>
                  <span className="cs-complexity-dots">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span
                        key={n}
                        className={`cs-complexity-dot ${n <= cs.complexity! ? "filled" : ""}`}
                      />
                    ))}
                  </span>
                  Complexity {cs.complexity}/5
                </span>
              )}
            </div>
          )}
        </div>
        <div className="cs-shape-tag">{cs.working_shape}</div>
      </header>

      <section className="cs-section cs-timeline-section">
        <div className="cs-section-label">Timeline</div>
        <CaseTimelineMinimap session={cs} />
        <CasePinList pins={cs.timeline.pins} />
      </section>

      <section className="cs-section cs-drill-section">
        <div className="cs-section-label">Drill observations</div>
        <div className="cs-drill-grid">
          <div className={`cs-drill-cell ${d.started_with_brainstorming ? "yes" : "no"}`}>
            <div className="cs-drill-q">Started with brainstorming?</div>
            <div className="cs-drill-a">{d.started_with_brainstorming ? "Yes" : "No"}</div>
          </div>
          <div className={`cs-drill-cell ${d.started_from_predefined_aspect ? "yes" : "no"}`}>
            <div className="cs-drill-q">Started from a predefined aspect?</div>
            <div className="cs-drill-a">{d.started_from_predefined_aspect ? "Yes" : "No"}</div>
          </div>
          <div className={`cs-drill-cell ${d.long_running_turns_count > 0 ? "yes" : "no"}`}>
            <div className="cs-drill-q">Long-running agent turns?</div>
            <div className="cs-drill-a">
              {d.long_running_turns_count > 0
                ? `${d.long_running_turns_count} turns · ${fmtMin(d.long_running_turns_total_min)} total`
                : "No"}
            </div>
          </div>
          <div className={`cs-drill-cell ${d.rapid_fire_after_initial ? "alert" : "no"}`}>
            <div className="cs-drill-q">Rapid-fire human steering after initial?</div>
            <div className="cs-drill-a">{d.rapid_fire_after_initial ? "Yes — last-mile hand-holding" : "No"}</div>
          </div>
        </div>
        {d.notes.length > 0 && (
          <ul className="cs-drill-notes">
            {d.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="cs-section cs-narrative-section">
        <div className="cs-section-label">Narrative</div>
        <div className="cs-narrative-block">
          <h4 className="cs-narrative-head">Why this session</h4>
          <p>{cs.narrative.why_picked}</p>
        </div>
        <div className="cs-narrative-block">
          <h4 className="cs-narrative-head">What happened</h4>
          <p>{cs.narrative.session_summary}</p>
        </div>
        <div className="cs-narrative-block">
          <h4 className="cs-narrative-head">Steering style</h4>
          <p>{cs.narrative.steering_summary}</p>
        </div>
        <div className="cs-narrative-row">
          <div className="cs-narrative-block half">
            <h4 className="cs-narrative-head positive">What worked</h4>
            <p>{cs.narrative.what_worked}</p>
          </div>
          <div className="cs-narrative-block half">
            <h4 className="cs-narrative-head warning">What hit friction</h4>
            <p>{cs.narrative.what_hit_friction}</p>
          </div>
        </div>
      </section>

      <section className="cs-section cs-signature-section">
        <div className="cs-section-label">Harness signature</div>
        <div className="cs-sig-grid">
          <div>
            <div className="cs-sig-heading">User-authored skills</div>
            {cs.harness_signature.user_skills.length === 0 ? (
              <div className="cs-sig-empty">—</div>
            ) : (
              cs.harness_signature.user_skills.map((s) => (
                <div key={s.name} className="cs-sig-row">
                  <code>{s.name}</code>
                  <span className="cs-sig-count">×{s.uses}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="cs-sig-heading">User-authored subagents</div>
            {cs.harness_signature.user_subagents.length === 0 ? (
              <div className="cs-sig-empty">—</div>
            ) : (
              cs.harness_signature.user_subagents.map((s) => (
                <div key={s.type} className="cs-sig-row">
                  <code>{s.type}</code>
                  <span className="cs-sig-count">×{s.count}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="cs-sig-heading">Stock skills</div>
            {cs.harness_signature.stock_skills.length === 0 ? (
              <div className="cs-sig-empty">—</div>
            ) : (
              cs.harness_signature.stock_skills.map((s) => (
                <div key={s.name} className="cs-sig-row">
                  <code>{s.name}</code>
                  <span className="cs-sig-count">×{s.uses}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <div className="cs-sig-heading">Top tools</div>
            {cs.harness_signature.top_tools.map((t) => (
              <div key={t} className="cs-sig-row">
                <code>{t}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="cs-steering">
          <span className="cs-section-label" style={{ marginRight: 12 }}>Steering snapshot</span>
          <span>
            <strong>{cs.steering.user_msg_count}</strong> user msgs
          </span>
          <span>
            <strong>{cs.steering.long_user_msg_count}</strong> long (≥800 chars)
          </span>
          <span>
            median <strong>{cs.steering.median_user_msg_chars}</strong> chars
          </span>
          <span>
            <strong>{cs.steering.interrupts}</strong> interrupts
          </span>
        </div>
      </section>
    </article>
  );
}

export function VariantCaseStudies({ r }: { r: TeamInsightReport }) {
  const p = r.variants.wow_pulse;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v2 · Case-studies-first.</strong> A compact aggregate band with week-over-week deltas
        at the top — combined agent time, sessions, tickets resolved, parallel-execution minutes,
        goal mix, skill usage, long-autonomous turn texture. Below it, the spine: deep walkthroughs
        of opt-in submitted sessions, each with a timeline minimap + annotated pins, harness signature,
        steering snapshot, narrative, and drill observations. No per-member fingerprint synthesis —
        the report shows what members chose to share, not a reverse-engineered judgment.
      </div>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>This week <em>vs. last week</em></h2>
          <div className="kicker">Tier-1 aggregates · what we have without anyone opting in</div>
        </header>

        <div className="wow-tile-row">
          <WowTile label="Combined agent time" value={`${p.agent_hours.current.toFixed(1)}h`} delta={deltaTag(p.agent_hours.delta_pct)} />
          <WowTile label="Sessions" value={p.sessions.current} delta={deltaTag(undefined, p.sessions.delta_abs)} />
          <WowTile
            label={`Tickets resolved (${p.tickets_resolved.source})`}
            value={p.tickets_resolved.current}
            delta={deltaTag(undefined, p.tickets_resolved.delta)}
            sub={p.tickets_resolved.sample_refs.slice(0, 3).join(" · ")}
          />
          <WowTile
            label="Parallel-execution minutes"
            value={`${p.parallel_execution.total_min} min`}
            delta={deltaTag(p.parallel_execution.total_min_wow_delta_pct)}
            sub={`peak ${p.parallel_execution.peak_concurrent}× concurrent`}
          />
        </div>

        <div className="wow-tile-row">
          <WowTile
            label="Long-autonomous turn texture"
            value={`${p.long_autonomous.count} turns · ${fmtMin(p.long_autonomous.total_min)} total`}
            delta={deltaTag(undefined, p.long_autonomous.count_wow_delta, " turns")}
            sub={`longest single ${fmtMin(p.long_autonomous.max_single_min)} · total time ${p.long_autonomous.total_min_wow_delta_pct > 0 ? "+" : ""}${p.long_autonomous.total_min_wow_delta_pct}% WoW · the texture matters more than the percentage — these turns are 6× the median session length`}
            wide
          />
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Time per project · WoW</div>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>This week</th>
                <th>Last week</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {p.project_time.map((pr) => (
                <tr key={pr.project}>
                  <td className="proj-name"><code>{pr.project}</code></td>
                  <td>{pr.hours_this_week.toFixed(1)}h</td>
                  <td className="muted">{pr.hours_last_week.toFixed(1)}h</td>
                  <td className={`delta ${pr.delta_pct > 0 ? "positive" : pr.delta_pct < 0 ? "negative" : ""}`}>
                    {pr.delta_pct > 0 ? "+" : ""}{pr.delta_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Goal mix · WoW (percentage-point change)</div>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Share this week</th>
                <th>Δ pp</th>
              </tr>
            </thead>
            <tbody>
              {p.goal_mix.map((g) => (
                <tr key={g.category}>
                  <td>{g.category}</td>
                  <td>{g.share_pct}%</td>
                  <td className={`delta ${g.delta_pp > 0 ? "positive" : g.delta_pp < 0 ? "negative" : ""}`}>
                    {g.delta_pp > 0 ? "+" : ""}{g.delta_pp}pp
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Skill usage · WoW</div>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>This week</th>
                <th>Last week</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {p.skill_usage.map((s) => (
                <tr key={s.skill}>
                  <td><code>{s.skill}</code></td>
                  <td>×{s.uses_this_week}</td>
                  <td className="muted">×{s.uses_last_week}</td>
                  <td className={`delta ${s.delta > 0 ? "positive" : s.delta < 0 ? "negative" : ""}`}>
                    {s.delta > 0 ? "+" : ""}{s.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2><em>Case studies</em> from submitted sessions</h2>
          <div className="kicker">
            Each card is one opt-in submission · {r.variants.case_studies.length} this week · the depth shows what only this view can show
          </div>
        </header>

        {r.variants.case_studies.map((cs) => (
          <CaseStudyCard key={cs.id} cs={cs} />
        ))}
      </section>

      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Closing <em>reflections</em></h2>
          <div className="kicker">Patterns the case studies surface, told as a column</div>
        </header>
        <article className="story-article">
          {r.variants.v2_closing.map((p, i) => (
            <section key={i} className="story-section">
              {p.heading && <h3 className="story-heading">{p.heading}</h3>}
              <p className="story-body">{p.body}</p>
            </section>
          ))}
        </article>
      </section>
    </div>
  );
}

function WowTile({
  label,
  value,
  delta,
  sub,
  wide,
}: {
  label: string;
  value: string | number;
  delta: { text: string; cls: string };
  sub?: string;
  wide?: boolean;
}) {
  return (
    <div className={`wow-tile${wide ? " wide" : ""}`}>
      <div className="wow-tile-label">{label}</div>
      <div className="wow-tile-value">{value}</div>
      <div className={`wow-tile-delta ${delta.cls}`}>{delta.text}</div>
      {sub && <div className="wow-tile-sub">{sub}</div>}
    </div>
  );
}
