import type {
  TeamInsightReport,
  InteractionType,
} from "../../app/team/[slug]/insights/types";
import { CaseStudyCard } from "./v2-case-studies";

const INTERACTION_LABEL: Record<InteractionType, string> = {
  directive: "Directive",
  "feedback-loop": "Feedback loop",
  "task-iteration": "Task iteration",
  validation: "Validation",
  learning: "Learning",
};

const INTERACTION_DESC: Record<InteractionType, string> = {
  directive: "Clear instruction → agent executes. Minimal mid-flight steering.",
  "feedback-loop": "Short back-and-forth turns. Often debug or refinement.",
  "task-iteration": "Multi-turn refinement of one task. The default shape for complex work.",
  validation: "Agent checks the human's work (reviewer subagents, spec critique).",
  learning: "Open exploration. Agent surfaces questions the human hadn't framed.",
};

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function deltaSpan(deltaPct: number, suffix = "%"): { text: string; cls: string } {
  if (deltaPct === 0) return { text: `±0${suffix}`, cls: "" };
  const sign = deltaPct > 0 ? "+" : "";
  return { text: `${sign}${deltaPct}${suffix}`, cls: deltaPct > 0 ? "positive" : "negative" };
}

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

export function VariantGrounded({ r }: { r: TeamInsightReport }) {
  const p = r.variants.wow_pulse;
  const x = r.variants.v3_extras;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v3 · Grounded in precedent.</strong> Inherits v2's case-studies-first spine,
        adds five things drawn from published frameworks: <em>(1)</em> Anthropic Economic Index
        interaction-type + complexity per case study, <em>(2)</em> acceptance-rate metric
        (universal across Anthropic / Copilot / Cursor / Cody), <em>(3)</em> automation share
        over four weeks, <em>(4)</em> Faros AI Productivity Paradox bottleneck-shift section,
        <em>(5)</em> DORA-style quality watch + explicit SPACE anti-Hawthorne methodology footer.
        Every borrowed concept carries a citation.
      </div>

      {/* ─── Top band: WoW + new headline metrics ─────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>This week <em>vs. last week</em></h2>
          <div className="kicker">
            Universal-vendor metrics + Economic Index shape signals · all Tier 1
          </div>
        </header>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Combined agent time</div>
            <div className="wow-tile-value">{p.agent_hours.current.toFixed(1)}h</div>
            <div className={`wow-tile-delta ${deltaSpan(p.agent_hours.delta_pct ?? 0).cls}`}>
              {deltaSpan(p.agent_hours.delta_pct ?? 0).text} vs last wk
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Sessions</div>
            <div className="wow-tile-value">{p.sessions.current}</div>
            <div className={`wow-tile-delta ${(p.sessions.delta_abs ?? 0) >= 0 ? "positive" : "negative"}`}>
              {(p.sessions.delta_abs ?? 0) >= 0 ? "+" : ""}{p.sessions.delta_abs} vs last wk
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">
              Acceptance rate <span className="cs-source-tag">universal</span>
            </div>
            <div className="wow-tile-value">{x.acceptance_rate.pct_this_week}%</div>
            <div className={`wow-tile-delta ${deltaSpan(x.acceptance_rate.delta_pp, "pp").cls}`}>
              {deltaSpan(x.acceptance_rate.delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">Agent-suggested edits that survived to commit.</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">
              Tickets resolved (Linear) <span className="cs-source-tag">external</span>
            </div>
            <div className="wow-tile-value">{p.tickets_resolved.current}</div>
            <div className={`wow-tile-delta ${(p.tickets_resolved.delta ?? 0) >= 0 ? "positive" : "negative"}`}>
              {(p.tickets_resolved.delta ?? 0) >= 0 ? "+" : ""}{p.tickets_resolved.delta} vs last wk
            </div>
            <div className="wow-tile-sub">{p.tickets_resolved.sample_refs.slice(0, 3).join(" · ")}</div>
          </div>
        </div>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">
              Automation share <span className="cs-source-tag">Economic Index</span>
            </div>
            <div className="wow-tile-value">{x.automation_share.automation_pct_this_week}%</div>
            <div className={`wow-tile-delta ${deltaSpan(x.automation_share.delta_pp, "pp").cls}`}>
              {deltaSpan(x.automation_share.delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">
              4-week trend: <span className="cs-spark">{sparkline(x.automation_share.automation_pct_trend)}</span>{" "}
              {x.automation_share.automation_pct_trend.join(" → ")}%
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">
              Median session complexity <span className="cs-source-tag">Economic Index</span>
            </div>
            <div className="wow-tile-value">{x.complexity_median_this_week.toFixed(1)}<span className="pulse-tile-suffix"> / 5</span></div>
            <div className={`wow-tile-delta ${x.complexity_median_this_week - x.complexity_median_last_week > 0 ? "positive" : x.complexity_median_this_week - x.complexity_median_last_week < 0 ? "negative" : ""}`}>
              {x.complexity_median_this_week > x.complexity_median_last_week ? "+" : ""}
              {(x.complexity_median_this_week - x.complexity_median_last_week).toFixed(1)} vs last wk
            </div>
            <div className="wow-tile-sub">1 = trivial · 5 = expert-only</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Parallel-execution minutes</div>
            <div className="wow-tile-value">{p.parallel_execution.total_min}m</div>
            <div className={`wow-tile-delta ${deltaSpan(p.parallel_execution.total_min_wow_delta_pct).cls}`}>
              {deltaSpan(p.parallel_execution.total_min_wow_delta_pct).text} vs last wk
            </div>
            <div className="wow-tile-sub">peak {p.parallel_execution.peak_concurrent}× concurrent</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Long-autonomous turns</div>
            <div className="wow-tile-value">
              {p.long_autonomous.count}<span className="pulse-tile-suffix"> · {fmtMin(p.long_autonomous.total_min)}</span>
            </div>
            <div className={`wow-tile-delta ${p.long_autonomous.count_wow_delta >= 0 ? "positive" : "negative"}`}>
              {p.long_autonomous.count_wow_delta >= 0 ? "+" : ""}{p.long_autonomous.count_wow_delta} turns ·{" "}
              {deltaSpan(p.long_autonomous.total_min_wow_delta_pct).text} total min
            </div>
            <div className="wow-tile-sub">longest single {fmtMin(p.long_autonomous.max_single_min)}</div>
          </div>
        </div>
      </section>

      {/* ─── Interaction-type mix (Economic Index taxonomy) ─────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Interaction-type <em>mix</em></h2>
          <div className="kicker">
            Per Anthropic Economic Index · five categories from directive to learning
          </div>
        </header>

        <div className="interaction-mix-bar">
          {x.interaction_type_mix.map((it) => (
            <div
              key={it.type}
              className={`interaction-mix-seg type-${it.type}`}
              style={{ width: `${it.share_pct}%` }}
              title={`${INTERACTION_LABEL[it.type]}: ${it.share_pct}%`}
            >
              {it.share_pct >= 10 ? `${it.share_pct}%` : ""}
            </div>
          ))}
        </div>
        <div className="interaction-mix-legend">
          {x.interaction_type_mix.map((it) => (
            <div key={it.type} className="interaction-mix-row">
              <span className={`interaction-mix-swatch type-${it.type}`} />
              <strong>{INTERACTION_LABEL[it.type]}</strong>
              <span className="interaction-mix-desc">{INTERACTION_DESC[it.type]}</span>
              <span className="interaction-mix-stats">
                {it.share_pct}%{" "}
                <span className={`delta ${it.delta_pp > 0 ? "positive" : it.delta_pp < 0 ? "negative" : ""}`}>
                  ({it.delta_pp > 0 ? "+" : ""}
                  {it.delta_pp}pp)
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Bottleneck shift (Faros AI Productivity Paradox) ─────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Where the <em>bottleneck</em> moved</h2>
          <div className="kicker">
            Faros AI Productivity Paradox · individual speed wins don't aggregate when the bottleneck silently relocates
          </div>
        </header>

        <div className="bottleneck-headline">{x.bottleneck_headline}</div>

        <table className="wow-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Phase</th>
              <th>This week</th>
              <th>Last week</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {x.bottleneck_shift.map((b) => {
              const isFlag = b.delta_pct > 50;
              return (
                <tr key={b.phase} className={isFlag ? "row-flagged" : ""}>
                  <td className="proj-name">{b.phase}</td>
                  <td>{fmtMin(b.minutes_this_week)}</td>
                  <td className="muted">{fmtMin(b.minutes_last_week)}</td>
                  <td className={`delta ${b.delta_pct > 0 ? "positive" : b.delta_pct < 0 ? "negative" : ""}`}>
                    {b.delta_pct > 0 ? "+" : ""}
                    {b.delta_pct}%{isFlag && <span className="bottleneck-flag-marker"> ⚑</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="cite-line">
          <a href="https://www.faros.ai/blog/ai-software-engineering" target="_blank" rel="noreferrer">
            Faros AI — 10,000-developer study on the AI Productivity Paradox →
          </a>
        </div>
      </section>

      {/* ─── Quality watch (DORA-style instability reporting) ──────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Quality <em>watch</em></h2>
          <div className="kicker">
            DORA 2025 · "AI doesn't fix a team; it amplifies what's already there"
          </div>
        </header>

        <div className="quality-watch-headline">{x.quality_watch.headline}</div>

        <div className="quality-tile-row">
          <div className="quality-tile">
            <div className="quality-tile-label">Reverts</div>
            <div className="quality-tile-value">{x.quality_watch.reverts_this_week}</div>
            <div className="quality-tile-sub">
              last week {x.quality_watch.reverts_last_week} ·{" "}
              <span
                className={`delta ${x.quality_watch.reverts_this_week > x.quality_watch.reverts_last_week ? "negative" : "positive"}`}
              >
                {x.quality_watch.reverts_this_week - x.quality_watch.reverts_last_week >= 0 ? "+" : ""}
                {x.quality_watch.reverts_this_week - x.quality_watch.reverts_last_week}
              </span>
            </div>
          </div>
          <div className="quality-tile">
            <div className="quality-tile-label">Rework PRs (&lt;24h follow-up)</div>
            <div className="quality-tile-value">{x.quality_watch.rework_prs_this_week}</div>
            <div className="quality-tile-sub">
              last week {x.quality_watch.rework_prs_last_week} ·{" "}
              <span
                className={`delta ${x.quality_watch.rework_prs_this_week > x.quality_watch.rework_prs_last_week ? "negative" : "positive"}`}
              >
                {x.quality_watch.rework_prs_this_week - x.quality_watch.rework_prs_last_week >= 0 ? "+" : ""}
                {x.quality_watch.rework_prs_this_week - x.quality_watch.rework_prs_last_week}
              </span>
            </div>
          </div>
          <div className="quality-tile">
            <div className="quality-tile-label">Incident-tagged sessions</div>
            <div className="quality-tile-value">{x.quality_watch.incident_tagged_sessions}</div>
            <div className="quality-tile-sub">PRs that triggered an oncall page or hotfix.</div>
          </div>
        </div>

        <div className="cite-line">
          <a
            href="https://cloud.google.com/resources/content/2025-dora-ai-assisted-software-development-report"
            target="_blank"
            rel="noreferrer"
          >
            DORA 2025 — AI-Assisted Software Development Report →
          </a>
        </div>
      </section>

      {/* ─── Case studies — same spine as v2 ─────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2><em>Case studies</em> from submitted sessions</h2>
          <div className="kicker">
            Each card carries an Economic Index interaction-type + complexity tag in its
            classification row · {r.variants.case_studies.length} this week
          </div>
        </header>

        {r.variants.case_studies.map((cs) => (
          <CaseStudyCard key={cs.id} cs={cs} />
        ))}
      </section>

      {/* ─── Closing — citations baked in ──────────────────────────────── */}
      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Closing <em>reflections</em></h2>
          <div className="kicker">Patterns the data shows, tied back to where the framing comes from</div>
        </header>
        <article className="story-article">
          {x.v3_closing.map((p, i) => (
            <section key={i} className="story-section">
              {p.heading && <h3 className="story-heading">{p.heading}</h3>}
              <p className="story-body">{p.body}</p>
              {p.cites && p.cites.length > 0 && (
                <div className="cite-row">
                  {p.cites.map((c) => (
                    <a key={c.href} href={c.href} target="_blank" rel="noreferrer">
                      {c.label} →
                    </a>
                  ))}
                </div>
              )}
            </section>
          ))}
        </article>
      </section>

      {/* ─── Methodology footer — the SPACE / Claude-Code-style honesty ── */}
      <section className="combined-section methodology-footer">
        <header className="combined-section-head">
          <h2>Methodology &amp; <em>honesty</em></h2>
          <div className="kicker">What's measured, what isn't, what's a proxy</div>
        </header>

        {x.methodology_notes.map((n, i) => (
          <div key={i} className="methodology-note">
            <div className="methodology-note-title">{n.title}</div>
            <p className="methodology-note-body">{n.body}</p>
            {n.citation && (
              <a className="methodology-cite" href={n.citation.href} target="_blank" rel="noreferrer">
                {n.citation.label} →
              </a>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
