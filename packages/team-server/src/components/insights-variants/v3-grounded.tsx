import type {
  TeamInsightReport,
  EconomicPurpose,
} from "../../app/team/[slug]/insights/types";
import { CaseStudyCard } from "./v2-case-studies";

const PURPOSE_LABEL: Record<EconomicPurpose, string> = {
  build: "Build",
  debug: "Debug",
  refactor: "Refactor",
  plan: "Plan",
  research: "Research",
  test: "Test",
  release: "Release",
  meta: "Meta",
};

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function deltaTag(delta: number, suffix = "%"): { text: string; cls: string } {
  if (delta === 0) return { text: `±0${suffix}`, cls: "" };
  const sign = delta > 0 ? "+" : "";
  return { text: `${sign}${delta}${suffix}`, cls: delta > 0 ? "positive" : "negative" };
}

function inverseDeltaTag(delta: number, suffix = "%"): { text: string; cls: string } {
  // For metrics where lower-is-better (lead time, churn, cost).
  if (delta === 0) return { text: `±0${suffix}`, cls: "" };
  const sign = delta > 0 ? "+" : "";
  return { text: `${sign}${delta}${suffix}`, cls: delta < 0 ? "positive" : "negative" };
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
        <strong>v3 · Grounded in Q1–Q2 2026 sources.</strong> Replaces the earlier v3 (which leaned on
        2024–2025 references) with the current 2026 frame: <em>DX AI Measurement Framework</em>
        (April 2026) as the Utilization / Impact / Cost backbone, <em>delegation gap</em> from
        Anthropic's 2026 Agentic Coding Trends Report as the headline metric, <em>five Economic Index
        primitives</em> (Anthropic January 2026) per case study, <em>context engineering</em> metrics
        (Fowler 2026), <em>harness engineering</em> metrics (OpenAI / Schmid 2026), and DORA with
        AI-attribution layers (2026 "Balancing AI tensions"). Each section names its source inline.
      </div>

      {/* ─── Delegation gap — Anthropic 2026 Agentic Coding Trends headline ── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>The delegation <em>gap</em></h2>
          <div className="kicker">
            Anthropic 2026 Agentic Coding Trends · "AI adoption %" is now table stakes; the gap is the
            growth headroom
          </div>
        </header>

        <div className="delegation-headline">{x.delegation_gap.headline}</div>

        <div className="delegation-row">
          <div className="delegation-block">
            <div className="delegation-block-label">Sessions using AI</div>
            <div className="delegation-block-value">{x.delegation_gap.used_pct}%</div>
            <div className="delegation-block-spark">
              {sparkline(x.delegation_gap.trend_used_pct)} {x.delegation_gap.trend_used_pct.join(" → ")}%
            </div>
          </div>
          <div className="delegation-arrow">→</div>
          <div className="delegation-block">
            <div className="delegation-block-label">Fully delegated (≤1 human turn post-brief)</div>
            <div className="delegation-block-value">{x.delegation_gap.fully_delegated_pct}%</div>
            <div className="delegation-block-spark">
              {sparkline(x.delegation_gap.trend_fully_delegated_pct)}{" "}
              {x.delegation_gap.trend_fully_delegated_pct.join(" → ")}%
            </div>
          </div>
          <div className="delegation-arrow">=</div>
          <div className="delegation-block delegation-gap">
            <div className="delegation-block-label">Gap</div>
            <div className="delegation-block-value">{x.delegation_gap.gap_pp}pp</div>
            <div className="delegation-block-spark">growth headroom</div>
          </div>
        </div>
      </section>

      {/* ─── DX AI Measurement Framework backbone ────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Utilization · Impact · <em>Cost</em></h2>
          <div className="kicker">
            DX AI Measurement Framework (Atlassian/DX, April 2026) · designed to layer on DX Core 4
          </div>
        </header>

        <div className="dx-grid">
          <div className="dx-pillar">
            <div className="dx-pillar-label">Utilization</div>
            <div className="dx-pillar-tagline">Where the team is reaching for the agent</div>
            <div className="dx-pillar-metrics">
              <div className="dx-metric">
                <div className="dx-metric-label">Sessions / eng / week</div>
                <div className="dx-metric-value">{x.dx_framework.utilization.sessions_per_eng_per_week.toFixed(1)}</div>
                <div className={`dx-metric-delta ${deltaTag(x.dx_framework.utilization.delta_pct).cls}`}>
                  {deltaTag(x.dx_framework.utilization.delta_pct).text} vs last wk
                </div>
              </div>
              <div className="dx-metric">
                <div className="dx-metric-label">PRs with agent assistance</div>
                <div className="dx-metric-value">{x.dx_framework.utilization.agent_assisted_pr_share_pct}%</div>
                <div className={`dx-metric-delta ${deltaTag(x.dx_framework.utilization.delta_pp, "pp").cls}`}>
                  {deltaTag(x.dx_framework.utilization.delta_pp, "pp").text} vs last wk
                </div>
              </div>
              <div className="dx-metric">
                <div className="dx-metric-label">Skills loaded / session</div>
                <div className="dx-metric-value">{x.dx_framework.utilization.skills_loaded_per_session.toFixed(1)}</div>
              </div>
            </div>
          </div>

          <div className="dx-pillar">
            <div className="dx-pillar-label">Impact</div>
            <div className="dx-pillar-tagline">What the team got shipped because of it</div>
            <div className="dx-pillar-metrics">
              <div className="dx-metric">
                <div className="dx-metric-label">Median first-user → merge</div>
                <div className="dx-metric-value">{x.dx_framework.impact.median_first_user_to_merge_min}m</div>
                <div className={`dx-metric-delta ${inverseDeltaTag(x.dx_framework.impact.delta_pct).cls}`}>
                  {inverseDeltaTag(x.dx_framework.impact.delta_pct).text} vs last wk
                </div>
              </div>
              <div className="dx-metric">
                <div className="dx-metric-label">Shipped via agent</div>
                <div className="dx-metric-value">{x.dx_framework.impact.shipped_via_agent_share_pct}%</div>
                <div className={`dx-metric-delta ${deltaTag(x.dx_framework.impact.delta_pp_shipped, "pp").cls}`}>
                  {deltaTag(x.dx_framework.impact.delta_pp_shipped, "pp").text} vs last wk
                </div>
              </div>
              <div className="dx-metric">
                <div className="dx-metric-label">Rework PR rate</div>
                <div className="dx-metric-value">{x.dx_framework.impact.rework_pr_pct}%</div>
                <div className={`dx-metric-delta ${inverseDeltaTag(x.dx_framework.impact.delta_pp, "pp").cls}`}>
                  {inverseDeltaTag(x.dx_framework.impact.delta_pp, "pp").text} vs last wk
                </div>
              </div>
            </div>
          </div>

          <div className="dx-pillar">
            <div className="dx-pillar-label">Cost</div>
            <div className="dx-pillar-tagline">What it took to make that impact</div>
            <div className="dx-pillar-metrics">
              <div className="dx-metric">
                <div className="dx-metric-label">Total spend</div>
                <div className="dx-metric-value">${x.dx_framework.cost.usd_total_week.toFixed(2)}</div>
                <div className={`dx-metric-delta ${deltaTag(x.dx_framework.cost.delta_pct).cls}`}>
                  {deltaTag(x.dx_framework.cost.delta_pct).text} vs last wk
                </div>
              </div>
              <div className="dx-metric">
                <div className="dx-metric-label">$ per shipped PR</div>
                <div className="dx-metric-value">${x.dx_framework.cost.usd_per_shipped_pr.toFixed(2)}</div>
                <div className={`dx-metric-delta ${inverseDeltaTag(x.dx_framework.cost.delta_pct_per_pr).cls}`}>
                  {inverseDeltaTag(x.dx_framework.cost.delta_pct_per_pr).text} vs last wk
                </div>
              </div>
              <div className="dx-metric">
                <div className="dx-metric-label">Plan burn</div>
                <div className="dx-metric-value">{x.dx_framework.cost.plan_burn_pct}%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="cite-line">
          <a href="https://getdx.com/whitepaper/ai-measurement-framework/" target="_blank" rel="noreferrer">
            DX AI Measurement Framework whitepaper (April 2026) →
          </a>
        </div>
      </section>

      {/* ─── Augmentation/automation flip — Economic Index Jan 2026 ─────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Augmentation ↔ <em>automation</em></h2>
          <div className="kicker">
            Anthropic Economic Index Jan 2026 · industry flipped to augmentation 52/45 (was
            automation-led Aug 2025)
          </div>
        </header>

        <div className="flip-bar">
          <div className="flip-seg flip-augmentation" style={{ width: `${x.flip.augmentation_pct_this_week}%` }}>
            Augmentation {x.flip.augmentation_pct_this_week}%
          </div>
          <div className="flip-seg flip-automation" style={{ width: `${x.flip.automation_pct_this_week}%` }}>
            Automation {x.flip.automation_pct_this_week}%
          </div>
        </div>

        <table className="wow-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Week</th>
              <th>Augmentation</th>
              <th>Automation</th>
            </tr>
          </thead>
          <tbody>
            {x.flip.trend_this_team.map((t) => (
              <tr key={t.week_monday}>
                <td className="proj-name">{t.week_monday}</td>
                <td>{t.augmentation_pct}%</td>
                <td>{t.automation_pct}%</td>
              </tr>
            ))}
            <tr style={{ background: "color-mix(in srgb, var(--mute) 8%, var(--paper))" }}>
              <td className="muted">Anthropic industry · Jan 2026</td>
              <td className="muted">{x.flip.industry_baseline_jan_2026.augmentation_pct}%</td>
              <td className="muted">{x.flip.industry_baseline_jan_2026.automation_pct}%</td>
            </tr>
          </tbody>
        </table>

        <div className="flip-note">{x.flip.note}</div>

        <div className="cite-line">
          <a
            href="https://www.anthropic.com/research/anthropic-economic-index-january-2026-report"
            target="_blank"
            rel="noreferrer"
          >
            Anthropic Economic Index · January 2026 →
          </a>
        </div>
      </section>

      {/* ─── Context engineering metrics — Fowler 2026 ─────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Context <em>engineering</em></h2>
          <div className="kicker">
            Martin Fowler / Anthropic 2026 · the post-prompt-engineering frontier
          </div>
        </header>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Conformity rate</div>
            <div className="wow-tile-value">{x.context_engineering.conformity_rate_pct}%</div>
            <div className={`wow-tile-delta ${deltaTag(x.context_engineering.conformity_delta_pp, "pp").cls}`}>
              {deltaTag(x.context_engineering.conformity_delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">Agent output that matches team standards (CLAUDE.md, skills, conventions).</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Rework ratio</div>
            <div className="wow-tile-value">{x.context_engineering.rework_ratio_pct}%</div>
            <div className={`wow-tile-delta ${inverseDeltaTag(x.context_engineering.rework_delta_pp, "pp").cls}`}>
              {inverseDeltaTag(x.context_engineering.rework_delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">Post-merge fix time as % of initial development time.</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Review depth</div>
            <div className="wow-tile-value">{x.context_engineering.review_depth_per_pr.toFixed(1)}</div>
            <div className={`wow-tile-delta ${deltaTag(x.context_engineering.review_depth_delta_pct).cls}`}>
              {deltaTag(x.context_engineering.review_depth_delta_pct).text} vs last wk
            </div>
            <div className="wow-tile-sub">Human review comments per agent-authored PR. (Climbing = healthy oversight.)</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">14-day code churn</div>
            <div className="wow-tile-value">{x.context_engineering.code_churn_14d_pct}%</div>
            <div className={`wow-tile-delta ${inverseDeltaTag(x.context_engineering.code_churn_delta_pp, "pp").cls}`}>
              {inverseDeltaTag(x.context_engineering.code_churn_delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">New code reverted within 14 days.</div>
          </div>
        </div>

        <div className="ce-context-files">
          <div className="ce-context-files-label">Context-file authorship</div>
          <div className="ce-context-files-bar">
            <div
              className="ce-context-files-seg human"
              style={{
                width: `${(x.context_engineering.user_authored_context_files / Math.max(1, x.context_engineering.user_authored_context_files + x.context_engineering.llm_authored_context_files)) * 100}%`,
              }}
            >
              Human-authored ×{x.context_engineering.user_authored_context_files}
            </div>
            {x.context_engineering.llm_authored_context_files > 0 && (
              <div
                className="ce-context-files-seg llm"
                style={{
                  width: `${(x.context_engineering.llm_authored_context_files / (x.context_engineering.user_authored_context_files + x.context_engineering.llm_authored_context_files)) * 100}%`,
                }}
              >
                LLM-authored ×{x.context_engineering.llm_authored_context_files}
              </div>
            )}
          </div>
          <div className="ce-context-files-note">
            Per Fowler / Anthropic 2026: LLM-authored context files reduce task resolution by ~3% and
            add 20%+ inference cost. Human-authored is the right ratio.
          </div>
        </div>

        <div className="cite-line">
          <a
            href="https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html"
            target="_blank"
            rel="noreferrer"
          >
            Context engineering for coding agents · Martin Fowler →
          </a>
        </div>
      </section>

      {/* ─── Harness engineering — OpenAI 2026 / Schmid 2026 ──────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Harness <em>engineering</em></h2>
          <div className="kicker">
            OpenAI / Philipp Schmid 2026 · properties of the orchestration shell, not the model
          </div>
        </header>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Working-memory budget · median use</div>
            <div className="wow-tile-value">{x.harness_engineering.working_memory_budget.median_pct_used}%</div>
            <div className="wow-tile-sub">
              {x.harness_engineering.working_memory_budget.sessions_over_80pct} sessions touched ≥80% of
              context window
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Cache hit rate</div>
            <div className="wow-tile-value">{x.harness_engineering.cache_hit_rate_pct}%</div>
            <div className={`wow-tile-delta ${deltaTag(x.harness_engineering.cache_hit_delta_pp, "pp").cls}`}>
              {deltaTag(x.harness_engineering.cache_hit_delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">Prompt-cache reuse — higher means cheaper repeat sessions.</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Tool-call success</div>
            <div className="wow-tile-value">{x.harness_engineering.tool_call_efficiency.successful_calls_pct}%</div>
            <div className="wow-tile-sub">
              {x.harness_engineering.tool_call_efficiency.median_tools_per_outcome_unit} median tools
              per shipped change
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Trajectory · session shape</div>
            <div className="wow-tile-value">
              {x.harness_engineering.trajectory_eval.sessions_with_steady_progress}
              <span className="pulse-tile-suffix"> steady</span>
            </div>
            <div className="wow-tile-sub">
              {x.harness_engineering.trajectory_eval.sessions_with_unforced_loops} unforced loops ·{" "}
              {x.harness_engineering.trajectory_eval.sessions_with_premature_completion} premature
              completions
            </div>
          </div>
        </div>

        <div className="cite-line">
          <a href="https://openai.com/index/harness-engineering/" target="_blank" rel="noreferrer">
            Harness engineering · OpenAI 2026 →
          </a>
        </div>
      </section>

      {/* ─── Five Economic Index primitives per session ──────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Economic Index primitives · per <em>session</em></h2>
          <div className="kicker">
            Anthropic Economic Index Jan 2026 · five primitives per opted-in session
          </div>
        </header>

        <table className="wow-table primitives-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Complexity</th>
              <th>Skill required</th>
              <th>Purpose</th>
              <th>AI autonomy</th>
              <th>Success</th>
            </tr>
          </thead>
          <tbody>
            {r.variants.case_studies.map((cs) => {
              const ep = cs.economic_primitives;
              if (!ep) return null;
              return (
                <tr key={cs.id}>
                  <td>
                    <strong>{cs.author}</strong>
                    <div className="primitives-session-meta">
                      {cs.date} · <code>{cs.project}</code>
                    </div>
                  </td>
                  <td className="primitives-cell">
                    <PrimitiveDots value={ep.task_complexity} />
                  </td>
                  <td className="primitives-cell">
                    <PrimitiveDots value={ep.skill_level_required} />
                  </td>
                  <td className="primitives-cell">{PURPOSE_LABEL[ep.purpose]}</td>
                  <td className="primitives-cell">
                    <PrimitiveDots value={ep.ai_autonomy} />
                  </td>
                  <td className="primitives-cell">
                    <PrimitiveDots value={ep.task_success} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="cite-line">
          <a
            href="https://www.anthropic.com/research/anthropic-economic-index-january-2026-report"
            target="_blank"
            rel="noreferrer"
          >
            Anthropic Economic Index · January 2026 · five primitives →
          </a>
        </div>
      </section>

      {/* ─── Case studies — same spine as v2, primitives applied per card ─ */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2><em>Case studies</em> from submitted sessions</h2>
          <div className="kicker">
            Each card carries its Economic Index interaction-type + complexity badge
          </div>
        </header>

        {r.variants.case_studies.map((cs) => (
          <CaseStudyCard key={cs.id} cs={cs} />
        ))}
      </section>

      {/* ─── DORA + AI attribution — DORA 2026 ─────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>DORA <em>with attribution</em></h2>
          <div className="kicker">
            DORA 2026 "Balancing AI tensions" · the four metrics need an AI-vs-human attribution layer
          </div>
        </header>

        <table className="wow-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Team value</th>
              <th>AI-attributed</th>
              <th>Human-attributed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="proj-name">Deployment frequency (PRs/day)</td>
              <td>{x.dora_attribution.deployment_frequency.current}</td>
              <td>{x.dora_attribution.deployment_frequency.ai_assisted_pct}% AI-assisted</td>
              <td className="muted">—</td>
            </tr>
            <tr>
              <td className="proj-name">Lead time (min)</td>
              <td>{x.dora_attribution.lead_time_min.current}m</td>
              <td className={x.dora_attribution.lead_time_min.ai_assisted_delta_pct < 0 ? "delta positive" : "delta negative"}>
                {x.dora_attribution.lead_time_min.ai_assisted_delta_pct > 0 ? "+" : ""}
                {x.dora_attribution.lead_time_min.ai_assisted_delta_pct}% vs team median
              </td>
              <td className="muted">—</td>
            </tr>
            <tr>
              <td className="proj-name">Change failure rate</td>
              <td>{x.dora_attribution.change_failure_rate_pct.current}%</td>
              <td>{x.dora_attribution.change_failure_rate_pct.ai_assisted}%</td>
              <td>{x.dora_attribution.change_failure_rate_pct.human_authored}%</td>
            </tr>
            <tr>
              <td className="proj-name">MTTR (min)</td>
              <td>{x.dora_attribution.mttr_min.current}m</td>
              <td className={x.dora_attribution.mttr_min.ai_assisted_delta_pct < 0 ? "delta positive" : "delta negative"}>
                {x.dora_attribution.mttr_min.ai_assisted_delta_pct > 0 ? "+" : ""}
                {x.dora_attribution.mttr_min.ai_assisted_delta_pct}% vs team median
              </td>
              <td className="muted">—</td>
            </tr>
          </tbody>
        </table>

        <div className="flip-note">{x.dora_attribution.note}</div>

        <div className="cite-line">
          <a href="https://dora.dev/insights/balancing-ai-tensions/" target="_blank" rel="noreferrer">
            DORA · Balancing AI tensions (2026) →
          </a>
        </div>
      </section>

      {/* ─── Closing — 2026 citations baked in ───────────────────── */}
      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Closing <em>reflections</em></h2>
          <div className="kicker">Patterns tied to the 2026 source that names them</div>
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

      {/* ─── Methodology footer — Q1-Q2 2026 sources only ──────────── */}
      <section className="combined-section methodology-footer">
        <header className="combined-section-head">
          <h2>Methodology &amp; <em>honesty</em></h2>
          <div className="kicker">What's measured, what isn't, what's a proxy · 2026 sources only</div>
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

function PrimitiveDots({ value }: { value: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span className="primitive-dots" title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`primitive-dot ${n <= value ? "filled" : ""}`} />
      ))}
      <span className="primitive-dots-value">{value}</span>
    </span>
  );
}
