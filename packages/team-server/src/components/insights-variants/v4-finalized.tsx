import type {
  TeamInsightReport,
  CapturabilityTier,
  EconomicPurpose,
} from "../../app/team/[slug]/insights/types";
import { CaseStudyCard } from "./v2-case-studies";

const TIER_LABEL: Record<CapturabilityTier, string> = {
  deterministic: "Deterministic",
  "llm-enriched": "LLM-enriched",
  "external-plug-in": "External plug-in",
};

const TIER_SYMBOL: Record<CapturabilityTier, string> = {
  deterministic: "▦",
  "llm-enriched": "✦",
  "external-plug-in": "◌",
};

function Cap({ tier }: { tier: CapturabilityTier }) {
  return (
    <span className={`cap-pill tier-${tier}`} title={TIER_LABEL[tier]}>
      <span className="cap-pill-symbol">{TIER_SYMBOL[tier]}</span>
      {TIER_LABEL[tier]}
    </span>
  );
}

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

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

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

export function VariantFinalized({ r }: { r: TeamInsightReport }) {
  const p = r.variants.wow_pulse;
  const x3 = r.variants.v3_extras;
  const x4 = r.variants.v4_extras;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v4 · Finalized for alignment.</strong> Combines the strongest bits across v1–v3 and
        is explicit about <em>capturability</em>: every section is tagged{" "}
        <Cap tier="deterministic" /> (raw JSONL today),{" "}
        <Cap tier="llm-enriched" /> (perception layer, opt-in per session), or{" "}
        <Cap tier="external-plug-in" /> (placeholder · would need a wired integration). What we can
        actually ship today is what's in the body of the report; what's behind integration work has
        its own dedicated section near the end.
      </div>

      <div className="cap-legend">
        <div className="cap-legend-label">Capturability legend</div>
        <div className="cap-legend-row">
          <Cap tier="deterministic" />
          <span>From raw JSONL counts and timestamps. Works today, no opt-in needed.</span>
        </div>
        <div className="cap-legend-row">
          <Cap tier="llm-enriched" />
          <span>From the perception-layer enrichment pipeline, applied per opted-in session.</span>
        </div>
        <div className="cap-legend-row">
          <Cap tier="external-plug-in" />
          <span>Needs a GitHub / Linear / CI integration. Listed in the "External integrations" section.</span>
        </div>
      </div>

      {/* ─── Team Pulse — all deterministic ─────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Team <em>pulse</em> · this week vs last <Cap tier="deterministic" /></h2>
          <div className="kicker">From JSONL — works on day 1 of a member joining</div>
        </header>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Combined agent time</div>
            <div className="wow-tile-value">{p.agent_hours.current.toFixed(1)}h</div>
            <div className={`wow-tile-delta ${deltaTag(p.agent_hours.delta_pct ?? 0).cls}`}>
              {deltaTag(p.agent_hours.delta_pct ?? 0).text} vs last wk
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
            <div className="wow-tile-label">Concurrency peak</div>
            <div className="wow-tile-value">{r.volume.concurrency_peak.peak}×</div>
            <div className="wow-tile-sub">on {r.volume.concurrency_peak.date}</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Parallel-execution minutes</div>
            <div className="wow-tile-value">{p.parallel_execution.total_min}m</div>
            <div className={`wow-tile-delta ${deltaTag(p.parallel_execution.total_min_wow_delta_pct).cls}`}>
              {deltaTag(p.parallel_execution.total_min_wow_delta_pct).text} vs last wk
            </div>
          </div>
        </div>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Long-autonomous turns</div>
            <div className="wow-tile-value">
              {p.long_autonomous.count}<span className="pulse-tile-suffix"> · {fmtMin(p.long_autonomous.total_min)}</span>
            </div>
            <div className={`wow-tile-delta ${p.long_autonomous.count_wow_delta >= 0 ? "positive" : "negative"}`}>
              {p.long_autonomous.count_wow_delta >= 0 ? "+" : ""}{p.long_autonomous.count_wow_delta} turns vs last wk
            </div>
            <div className="wow-tile-sub">longest single {fmtMin(p.long_autonomous.max_single_min)}</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Cache hit rate</div>
            <div className="wow-tile-value">{x3.harness_engineering.cache_hit_rate_pct}%</div>
            <div className={`wow-tile-delta ${deltaTag(x3.harness_engineering.cache_hit_delta_pp, "pp").cls}`}>
              {deltaTag(x3.harness_engineering.cache_hit_delta_pp, "pp").text} vs last wk
            </div>
            <div className="wow-tile-sub">prompt-cache reuse — higher = cheaper repeats</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Tool-call success</div>
            <div className="wow-tile-value">{x3.harness_engineering.tool_call_efficiency.successful_calls_pct}%</div>
            <div className="wow-tile-sub">
              {x3.harness_engineering.tool_call_efficiency.median_tools_per_outcome_unit} median tools per shipped change
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Working-memory budget · median use</div>
            <div className="wow-tile-value">{x3.harness_engineering.working_memory_budget.median_pct_used}%</div>
            <div className="wow-tile-sub">
              {x3.harness_engineering.working_memory_budget.sessions_over_80pct} sessions touched ≥80% of context window
            </div>
          </div>
        </div>
      </section>

      {/* ─── Delegation depth ──────────────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Delegation <em>depth</em> · how the human shows up <Cap tier="deterministic" /></h2>
          <div className="kicker">
            Distribution of sessions by post-brief human turns · Anthropic 2026 framing applied to within-team data
          </div>
        </header>

        <div className="delegation-headline">{x4.delegation_depth.headline}</div>

        <div className="delegation-depth-bar">
          <div className="delegation-depth-seg seg-fully" style={{ width: `${x4.delegation_depth.fully_delegated_pct}%` }}>
            Fully delegated {x4.delegation_depth.fully_delegated_pct}%
          </div>
          <div className="delegation-depth-seg seg-mid" style={{ width: `${x4.delegation_depth.mid_delegation_pct}%` }}>
            Mid-delegation {x4.delegation_depth.mid_delegation_pct}%
          </div>
          <div className="delegation-depth-seg seg-heavy" style={{ width: `${x4.delegation_depth.heavy_steering_pct}%` }}>
            Heavy steering {x4.delegation_depth.heavy_steering_pct}%
          </div>
        </div>

        <div className="delegation-depth-legend">
          <div>
            <strong>Fully delegated</strong> · ≤1 human turn after the initial brief. The agent runs to completion.
          </div>
          <div>
            <strong>Mid-delegation</strong> · 2–9 human turns. Steady back-and-forth, agent does substantial chunks autonomously.
          </div>
          <div>
            <strong>Heavy steering</strong> · ≥10 human turns. Often rapid-fire debug. The harness covers part of the work; the human carries the last mile.
          </div>
        </div>

        <div className="wow-tile-row" style={{ marginTop: 18 }}>
          <div className="wow-tile">
            <div className="wow-tile-label">4-week trend · fully delegated %</div>
            <div className="wow-tile-value">
              <span className="cs-spark">{sparkline(x4.delegation_depth.trend_fully_delegated_4w)}</span>
            </div>
            <div className="wow-tile-sub">{x4.delegation_depth.trend_fully_delegated_4w.join(" → ")}%</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">4-week trend · heavy steering %</div>
            <div className="wow-tile-value">
              <span className="cs-spark">{sparkline(x4.delegation_depth.trend_heavy_steering_4w)}</span>
            </div>
            <div className="wow-tile-sub">{x4.delegation_depth.trend_heavy_steering_4w.join(" → ")}%</div>
          </div>
        </div>
      </section>

      {/* ─── Augmentation vs automation ───────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Augmentation ↔ <em>automation</em> <Cap tier="deterministic" /></h2>
          <div className="kicker">
            Classified from working-shape taxonomy · industry baseline from Anthropic Economic Index Jan 2026
          </div>
        </header>

        <div className="flip-bar">
          <div className="flip-seg flip-augmentation" style={{ width: `${x3.flip.augmentation_pct_this_week}%` }}>
            Augmentation {x3.flip.augmentation_pct_this_week}%
          </div>
          <div className="flip-seg flip-automation" style={{ width: `${x3.flip.automation_pct_this_week}%` }}>
            Automation {x3.flip.automation_pct_this_week}%
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
            {x3.flip.trend_this_team.map((t) => (
              <tr key={t.week_monday}>
                <td className="proj-name">{t.week_monday}</td>
                <td>{t.augmentation_pct}%</td>
                <td>{t.automation_pct}%</td>
              </tr>
            ))}
            <tr style={{ background: "color-mix(in srgb, var(--mute) 8%, var(--paper))" }}>
              <td className="muted">Anthropic industry · Jan 2026</td>
              <td className="muted">{x3.flip.industry_baseline_jan_2026.augmentation_pct}%</td>
              <td className="muted">{x3.flip.industry_baseline_jan_2026.automation_pct}%</td>
            </tr>
          </tbody>
        </table>

        <div className="flip-note">{x3.flip.note}</div>

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

      {/* ─── Purpose mix + per-project time (bar charts) ───────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Purpose · per-project <em>time</em> <Cap tier="llm-enriched" /></h2>
          <div className="kicker">
            Goal-category from perception-layer enrichment · per-project hours deterministic from JSONL cwd
          </div>
        </header>

        <div className="wow-block">
          <div className="wow-block-label">Purpose mix · % of agent time</div>
          <div className="bar-chart">
            {p.goal_mix.map((g, i) => (
              <div key={g.category} className="bar-chart-row">
                <div className="bar-chart-label">{g.category}</div>
                <div className="bar-chart-track">
                  <div
                    className={`bar-chart-fill purpose-color-${i % 6}`}
                    style={{ width: `${(g.share_pct / Math.max(...p.goal_mix.map((x) => x.share_pct), 1)) * 100}%` }}
                  >
                    <span className="bar-chart-fill-value">{g.share_pct}%</span>
                  </div>
                </div>
                <div className={`bar-chart-delta ${g.delta_pp > 0 ? "positive" : g.delta_pp < 0 ? "negative" : ""}`}>
                  {g.delta_pp > 0 ? "+" : ""}{g.delta_pp}pp
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Per-project time · this week vs last week</div>
          <div className="bar-chart paired-bar-chart">
            {p.project_time.map((pr) => {
              const max = Math.max(
                ...p.project_time.flatMap((x) => [x.hours_this_week, x.hours_last_week]),
                1,
              );
              return (
                <div key={pr.project} className="paired-bar-row">
                  <div className="bar-chart-label"><code>{pr.project}</code></div>
                  <div className="paired-bar-tracks">
                    <div className="paired-bar-track">
                      <div
                        className="paired-bar-fill this-week"
                        style={{ width: `${(pr.hours_this_week / max) * 100}%` }}
                      >
                        <span className="paired-bar-fill-value">{pr.hours_this_week.toFixed(1)}h</span>
                      </div>
                    </div>
                    <div className="paired-bar-track">
                      <div
                        className="paired-bar-fill last-week"
                        style={{ width: `${(pr.hours_last_week / max) * 100}%` }}
                      >
                        <span className="paired-bar-fill-value">{pr.hours_last_week.toFixed(1)}h</span>
                      </div>
                    </div>
                  </div>
                  <div className={`bar-chart-delta ${pr.delta_pct > 0 ? "positive" : pr.delta_pct < 0 ? "negative" : ""}`}>
                    {pr.delta_pct > 0 ? "+" : ""}{pr.delta_pct}%
                  </div>
                </div>
              );
            })}
            <div className="paired-bar-legend">
              <span><span className="paired-bar-swatch this-week" /> This week</span>
              <span><span className="paired-bar-swatch last-week" /> Last week</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Skill & harness diffusion (visual) ──────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Skill &amp; harness <em>diffusion</em> <Cap tier="deterministic" /></h2>
          <div className="kicker">
            User-authored skills · cross-member pickups · the strongest signal only visible at team scale
          </div>
        </header>

        <div className="wow-block">
          <div className="wow-block-label">User-authored skills · adoption shape</div>
          <div className="skill-adoption-list">
            {r.skills_harness.user_authored_skills.map((s) => {
              const maxUses = Math.max(...r.skills_harness.user_authored_skills.map((x) => x.uses), 1);
              const adoptionPct = (s.adopters / r.members_total) * 100;
              return (
                <div key={s.name} className="skill-adoption-row">
                  <div className="skill-adoption-meta">
                    <code className="skill-adoption-name">{s.name}</code>
                    <span className="skill-adoption-origin">
                      by <strong>{s.originated_by}</strong>
                    </span>
                  </div>
                  <div className="skill-adoption-bars">
                    <div className="skill-adoption-bar-label">Adoption</div>
                    <div className="skill-adoption-bar-track">
                      <div className="skill-adoption-bar-fill adopters" style={{ width: `${adoptionPct}%` }}>
                        <span className="skill-adoption-bar-value">
                          {s.adopters} of {r.members_total} members
                        </span>
                      </div>
                    </div>
                    <div className="skill-adoption-bar-label">Uses</div>
                    <div className="skill-adoption-bar-track">
                      <div className="skill-adoption-bar-fill uses" style={{ width: `${(s.uses / maxUses) * 100}%` }}>
                        <span className="skill-adoption-bar-value">×{s.uses}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Skill pickups this week · diffusion arrows</div>
          <div className="diffusion-arrows">
            {r.skills_harness.skill_diffusion_events.map((e, i) => (
              <div key={i} className="diffusion-arrow-row">
                <div className="diffusion-arrow-member origin">{e.from_member}</div>
                <div className="diffusion-arrow-line">
                  <div className="diffusion-arrow-shaft" />
                  <div className="diffusion-arrow-head" />
                  <div className="diffusion-arrow-skill">
                    <code>{e.skill}</code>
                  </div>
                  <div className="diffusion-arrow-date">{e.date}</div>
                </div>
                <div className="diffusion-arrow-member target">{e.to_member}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Skill usage · this week vs last week</div>
          <div className="bar-chart paired-bar-chart">
            {p.skill_usage.map((s) => {
              const max = Math.max(...p.skill_usage.flatMap((x) => [x.uses_this_week, x.uses_last_week]), 1);
              return (
                <div key={s.skill} className="paired-bar-row">
                  <div className="bar-chart-label"><code>{s.skill}</code></div>
                  <div className="paired-bar-tracks">
                    <div className="paired-bar-track">
                      <div
                        className="paired-bar-fill this-week"
                        style={{ width: `${(s.uses_this_week / max) * 100}%` }}
                      >
                        <span className="paired-bar-fill-value">×{s.uses_this_week}</span>
                      </div>
                    </div>
                    <div className="paired-bar-track">
                      <div
                        className="paired-bar-fill last-week"
                        style={{ width: `${(s.uses_last_week / max) * 100}%` }}
                      >
                        <span className="paired-bar-fill-value">×{s.uses_last_week}</span>
                      </div>
                    </div>
                  </div>
                  <div className={`bar-chart-delta ${s.delta > 0 ? "positive" : s.delta < 0 ? "negative" : ""}`}>
                    {s.delta > 0 ? "+" : ""}{s.delta}
                  </div>
                </div>
              );
            })}
            <div className="paired-bar-legend">
              <span><span className="paired-bar-swatch this-week" /> This week</span>
              <span><span className="paired-bar-swatch last-week" /> Last week</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Economic Index primitives · honest capturability split ────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Economic Index <em>primitives</em> · per session</h2>
          <div className="kicker">
            Anthropic Jan 2026 taxonomy · one truly deterministic primitive, four LLM-enriched
          </div>
        </header>

        <div className="primitives-honesty-note">
          <strong>Honest capturability:</strong> only AI autonomy can be computed from raw JSONL with no
          model in the loop. Three of the other four primitives (purpose, task success, task complexity)
          come from the perception layer's existing LLM enrichment — buildable today, but they require
          the member to have opted that session into enrichment. Skill level required would need a
          small prompt-extension on top of existing enrichment. The earlier framing in this report
          claimed three primitives as deterministic; that over-claimed.
        </div>

        <div className="primitives-cap-row">
          <div className="primitives-cap-tile">
            <Cap tier="deterministic" />
            <div className="primitives-cap-list">AI autonomy</div>
            <div className="primitives-cap-note">
              Counted from post-brief human turns. Pure JSONL arithmetic — no model in the loop, no
              opt-in needed.
            </div>
          </div>
          <div className="primitives-cap-tile">
            <Cap tier="llm-enriched" />
            <div className="primitives-cap-list">
              Purpose · Task success · Task complexity · Skill level required
            </div>
            <div className="primitives-cap-note">
              Purpose and task success exist today in the perception-layer enrichment (`goal_categories`
              and `outcome`). Complexity and skill-level need a small prompt-extension on top. All four
              live behind opt-in — they're real, not aspirational, just not free.
            </div>
          </div>
        </div>

        <table className="wow-table primitives-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Session</th>
              <th>Purpose</th>
              <th>AI autonomy</th>
              <th>Task success</th>
              <th>Complexity</th>
              <th>Skill required</th>
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
                  <td className="primitives-cell">{PURPOSE_LABEL[ep.purpose]}</td>
                  <td className="primitives-cell"><PrimitiveDots value={ep.ai_autonomy} /></td>
                  <td className="primitives-cell"><PrimitiveDots value={ep.task_success} /></td>
                  <td className="primitives-cell"><PrimitiveDots value={ep.task_complexity} /></td>
                  <td className="primitives-cell"><PrimitiveDots value={ep.skill_level_required} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ─── Case studies — the spine ────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2><em>Case studies</em> from submitted sessions <Cap tier="llm-enriched" /></h2>
          <div className="kicker">
            Opt-in per session · the qualitative spine · each card mixes deterministic timeline / counts with LLM-enriched narrative
          </div>
        </header>

        {r.variants.case_studies.map((cs) => (
          <CaseStudyCard key={cs.id} cs={cs} />
        ))}
      </section>

      {/* ─── External integrations placeholder ─────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>External <em>integrations</em> · what's not yet captured <Cap tier="external-plug-in" /></h2>
          <div className="kicker">
            Honest placeholder · names what each integration would unlock, not faked numbers
          </div>
        </header>

        {x4.external_integrations.map((eint) => (
          <div key={eint.name} className={`external-integration-card status-${eint.status}`}>
            <div className="external-integration-head">
              <span className="external-integration-name">{eint.name}</span>
              <span className={`external-integration-status status-${eint.status}`}>
                {eint.status === "connected"
                  ? "Connected"
                  : eint.status === "available-via-plug-in"
                  ? "Available via plug-in"
                  : "Not yet connected"}
              </span>
            </div>
            <div className="external-integration-note">{eint.integration_note}</div>
            <div className="external-integration-list-label">Would capture:</div>
            <ul className="external-integration-list">
              {eint.would_capture.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ─── Closing reflections ───────────────────────────────────── */}
      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Closing <em>reflections</em> <Cap tier="llm-enriched" /></h2>
          <div className="kicker">What the report can and can't say today, told straight</div>
        </header>
        <article className="story-article">
          {x4.v4_closing.map((p, i) => (
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

      {/* ─── Methodology footer ─────────────────────────────────── */}
      <section className="combined-section methodology-footer">
        <header className="combined-section-head">
          <h2>Methodology &amp; <em>honesty</em></h2>
          <div className="kicker">Eight notes · every one carries a capturability tag and (where relevant) a 2026 citation</div>
        </header>

        {x4.methodology_notes.map((n, i) => (
          <div key={i} className="methodology-note">
            <div className="methodology-note-title">
              {n.title} <Cap tier={n.capturability} />
            </div>
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
