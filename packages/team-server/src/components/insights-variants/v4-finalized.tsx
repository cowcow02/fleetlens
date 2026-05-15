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

      {/* ─── Purpose mix + per-project time ────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Purpose · per-project <em>time</em> <Cap tier="deterministic" /></h2>
          <div className="kicker">
            Goal-category mix from perception layer · per-project hours from JSONL cwd
          </div>
        </header>

        <div className="wow-block">
          <div className="wow-block-label">Purpose mix · % of agent time</div>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Share this wk</th>
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
          <div className="wow-block-label">Per-project time · WoW</div>
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
      </section>

      {/* ─── Skill & harness diffusion ─────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Skill &amp; harness <em>diffusion</em> <Cap tier="deterministic" /></h2>
          <div className="kicker">
            User-authored skills · cross-member pickups · the strongest signal that's only visible at team scale
          </div>
        </header>

        <div className="wow-block">
          <div className="wow-block-label">User-authored skills · who built it, who picked it up</div>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Origin</th>
                <th>Adopters</th>
                <th>Uses</th>
              </tr>
            </thead>
            <tbody>
              {r.skills_harness.user_authored_skills.map((s) => (
                <tr key={s.name}>
                  <td><code>{s.name}</code></td>
                  <td><strong>{s.originated_by}</strong></td>
                  <td>{s.adopters}</td>
                  <td>×{s.uses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Skill pickups this week</div>
          {r.skills_harness.skill_diffusion_events.map((e, i) => (
            <div key={i} className="narrative-line">
              <code>{e.skill}</code> · <strong>{e.from_member}</strong> → <strong>{e.to_member}</strong> on {e.date}
            </div>
          ))}
        </div>

        <div className="wow-block">
          <div className="wow-block-label">Skill usage · WoW</div>
          <table className="wow-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>This wk</th>
                <th>Last wk</th>
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

      {/* ─── Economic Index primitives mix · capturability tagged ──────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Economic Index <em>primitives</em> · per session</h2>
          <div className="kicker">
            Anthropic Jan 2026 taxonomy · three primitives deterministic, two LLM-enriched
          </div>
        </header>

        <div className="primitives-cap-row">
          <div className="primitives-cap-tile">
            <Cap tier="deterministic" />
            <div className="primitives-cap-list">Purpose · AI autonomy · Task success</div>
            <div className="primitives-cap-note">
              Purpose from existing goal-category enrichment. AI autonomy from post-brief turn count. Task success from the outcome enum.
            </div>
          </div>
          <div className="primitives-cap-tile">
            <Cap tier="llm-enriched" />
            <div className="primitives-cap-list">Task complexity · Skill level required</div>
            <div className="primitives-cap-note">
              Both come from the perception layer's enrichment LLM. The prompt extension is small — buildable today, not blocked.
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
