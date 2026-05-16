"use client";

import type {
  TeamInsightReport,
  V5ActionCard,
  V5RiskSignal,
  V5PairedMetric,
  V5Investment,
  V5OneOnOnePrompt,
  V5DemoCandidate,
} from "../../app/team/[slug]/insights/types";

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

export function ActionCardBlock({ kind, cards }: { kind: "strength" | "dysfunction"; cards: V5ActionCard[] }) {
  return (
    <div className="action-card-stack">
      {cards.map((c, i) => (
        <div key={i} className={`action-card kind-${kind}`}>
          <div className="action-card-observation">{c.observation}</div>
          <div className="action-card-metric">{c.metric}</div>
          <div className="action-card-action">
            <span className="action-card-action-label">Action</span>
            <span className="action-card-action-text">{c.action}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RiskSignalTile({ signal }: { signal: V5RiskSignal }) {
  return (
    <div className={`risk-tile level-${signal.level}`}>
      <div className="risk-tile-head">
        <span className="risk-tile-name">{signal.name}</span>
        <span className={`risk-tile-badge level-${signal.level}`}>{signal.level.toUpperCase()}</span>
      </div>
      <div className="risk-tile-value">{signal.current_value}</div>
      <div className="risk-tile-threshold">{signal.threshold_note}</div>
      <div className="risk-tile-trend">
        4-week trend <span className="risk-tile-spark">{sparkline(signal.trend_4w)}</span>{" "}
        {signal.trend_4w.join(" → ")}
      </div>
      <div className="risk-tile-action">
        <span className="action-card-action-label">Action</span>
        <span className="action-card-action-text">{signal.action}</span>
      </div>
    </div>
  );
}

export function PairedMetricRow({ pm }: { pm: V5PairedMetric }) {
  return (
    <div className="paired-metric-row">
      <div className="paired-metric-side speed">
        <div className="paired-metric-label">{pm.speed.label}</div>
        <div className="paired-metric-value">{pm.speed.value}</div>
        {pm.speed.delta && (
          <div className={`paired-metric-delta ${pm.speed.delta_class ?? ""}`}>{pm.speed.delta}</div>
        )}
      </div>
      <div className="paired-metric-side quality">
        <div className="paired-metric-label">{pm.quality.label}</div>
        <div className="paired-metric-value">{pm.quality.value}</div>
        {pm.quality.delta && (
          <div className={`paired-metric-delta ${pm.quality.delta_class ?? ""}`}>{pm.quality.delta}</div>
        )}
      </div>
      <div className="paired-metric-read">{pm.honest_read}</div>
    </div>
  );
}

export function InvestmentCard({ inv }: { inv: V5Investment }) {
  return (
    <div className="investment-card">
      <div className="investment-card-head">
        <span className="investment-card-title">{inv.title}</span>
        <span className={`investment-effort effort-${inv.effort}`}>{inv.effort}</span>
      </div>
      <div className="investment-card-rationale">{inv.rationale}</div>
      <div className="investment-card-evidence">
        <span className="investment-evidence-label">Evidence</span> {inv.evidence}
      </div>
    </div>
  );
}

export function OneOnOneCard({ p }: { p: V5OneOnOnePrompt }) {
  return (
    <div className="oneonone-card">
      <div className="oneonone-member">{p.member}</div>
      <div className="oneonone-prompt">{p.prompt}</div>
      <div className="oneonone-evidence">{p.evidence}</div>
    </div>
  );
}

export function DemoCard({ d }: { d: V5DemoCandidate }) {
  return (
    <div className="demo-card">
      <div className="demo-member">{d.member}</div>
      <div className="demo-session">{d.session_label}</div>
      <div className="demo-line">{d.one_line}</div>
    </div>
  );
}

export function VariantConnected({ r }: { r: TeamInsightReport }) {
  const v = r.variants.v5_extras;
  const a = v.actionables;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v5 · Manager actionables.</strong> Every section ends with a concrete next step.
        Builds on v4's metrics + v3's framings; the bottleneck-vs-throughput and amplifier ideas come
        from the DORA{" "}
        <a href="https://dora.dev/insights/balancing-ai-tensions/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
          Balancing AI tensions
        </a>{" "}
        article, but baked into the signal selection — no quotes, no framework cards, no theory. The
        data substrate from the integration-hypothetical sits in the appendix.
      </div>

      {/* ─── Hero takeaway ─────────────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>This <em>week</em></h2>
          <div className="kicker">The one thing to walk away with</div>
        </header>
        <div className="hero-takeaway">{a.hero_takeaway}</div>
      </section>

      {/* ─── Strengths to lean into ────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Strengths to <em>lean into</em></h2>
          <div className="kicker">Three things working — each with a way to amplify it further</div>
        </header>
        <ActionCardBlock kind="strength" cards={a.strengths} />
      </section>

      {/* ─── Dysfunctions to watch ─────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Dysfunctions to <em>watch</em></h2>
          <div className="kicker">Three things to address — same signals AI amplifies if left unattended</div>
        </header>
        <ActionCardBlock kind="dysfunction" cards={a.dysfunctions} />
      </section>

      {/* ─── Risk signals ──────────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Risk <em>signals</em></h2>
          <div className="kicker">Three monitored bands · trends + thresholds + next steps</div>
        </header>
        <div className="risk-tile-row">
          {a.risk_signals.map((s) => (
            <RiskSignalTile key={s.name} signal={s} />
          ))}
        </div>
      </section>

      {/* ─── Bottleneck callout ────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Bottleneck <em>this week</em></h2>
          <div className="kicker">Where time grew most · and how to alleviate it</div>
        </header>
        <div className="bottleneck-block">
          <div className="bottleneck-block-head">
            <div className="bottleneck-block-phase">
              <span className="bottleneck-block-phase-label">{a.bottleneck_callout.phase.toUpperCase()}</span>
              <span className="bottleneck-block-phase-delta">
                +{a.bottleneck_callout.delta_pct}% WoW
              </span>
            </div>
            <div className="bottleneck-block-headline">{a.bottleneck_callout.headline}</div>
          </div>
          <div className="bottleneck-block-action">
            <span className="action-card-action-label">Action</span>
            <span className="action-card-action-text">{a.bottleneck_callout.action}</span>
          </div>

          <div className="bottleneck-pipeline">
            <div className="bottleneck-pipeline-label">Phase breakdown (medians)</div>
            <div className="bottleneck-pipeline-bars">
              {v.pipeline.phases.map((ph) => {
                const max = Math.max(...v.pipeline.phases.map((p) => p.median_min), 1);
                const isFocus = ph.name === "review";
                return (
                  <div key={ph.name} className={`bottleneck-pipeline-bar ${isFocus ? "focus" : ""}`}>
                    <span className="bottleneck-pipeline-bar-name">{ph.label.split("→")[1]?.trim() ?? ph.label}</span>
                    <span className="bottleneck-pipeline-bar-track">
                      <span
                        className="bottleneck-pipeline-bar-fill"
                        style={{ width: `${(ph.median_min / max) * 100}%` }}
                      />
                    </span>
                    <span className="bottleneck-pipeline-bar-value">{fmtMin(ph.median_min)}</span>
                    <span className={`bottleneck-pipeline-bar-delta ${ph.delta_pct_wow > 0 ? "negative" : ph.delta_pct_wow < 0 ? "positive" : ""}`}>
                      {ph.delta_pct_wow > 0 ? "+" : ""}
                      {ph.delta_pct_wow}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Speed + quality paired ────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Speed <em>and</em> quality, paired</h2>
          <div className="kicker">Every speed metric next to its quality counterpart · no throughput-alone reading</div>
        </header>
        <div className="paired-metric-stack">
          {a.paired_metrics.map((pm, i) => (
            <PairedMetricRow key={i} pm={pm} />
          ))}
        </div>
      </section>

      {/* ─── Investment recommendations ────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Investments for <em>next week</em></h2>
          <div className="kicker">Six recommendations derived from this week's data · effort-tagged</div>
        </header>
        <div className="investment-grid">
          {a.investments.map((inv, i) => (
            <InvestmentCard key={i} inv={inv} />
          ))}
        </div>
      </section>

      {/* ─── 1:1 prompts ───────────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>For next <em>1:1s</em></h2>
          <div className="kicker">Concrete prompts per member · each anchored to a specific signal</div>
        </header>
        <div className="oneonone-stack">
          {a.oneonone_prompts.map((p, i) => (
            <OneOnOneCard key={i} p={p} />
          ))}
        </div>
      </section>

      {/* ─── Friday demo candidates ────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Friday demo <em>candidates</em></h2>
          <div className="kicker">Sessions worth a 5-minute team showcase</div>
        </header>
        <div className="demo-grid">
          {a.demo_candidates.map((d, i) => (
            <DemoCard key={i} d={d} />
          ))}
        </div>
      </section>

      {/* ─── Appendix · the data substrate ─────────────────────── */}
      <section className="combined-section appendix-section">
        <header className="combined-section-head">
          <h2>Appendix · the data <em>substrate</em></h2>
          <div className="kicker">{a.appendix_note}</div>
        </header>

        <details className="appendix-fold">
          <summary>Full pipeline phase table — Linear → deployed</summary>
          <div style={{ marginTop: 16 }}>
            <table className="wow-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Phase</th>
                  <th>Median</th>
                  <th>WoW Δ</th>
                  <th>Data source</th>
                </tr>
              </thead>
              <tbody>
                {v.pipeline.phases.map((ph, i) => (
                  <tr key={ph.name}>
                    <td>{i + 1}</td>
                    <td className="proj-name">{ph.label}</td>
                    <td>{fmtMin(ph.median_min)}</td>
                    <td className={`delta ${ph.delta_pct_wow > 0 ? "negative" : ph.delta_pct_wow < 0 ? "positive" : ""}`}>
                      {ph.delta_pct_wow > 0 ? "+" : ""}
                      {ph.delta_pct_wow}%
                    </td>
                    <td className="muted">{ph.attribution_note}</td>
                  </tr>
                ))}
                <tr style={{ background: "color-mix(in srgb, var(--accent) 6%, var(--paper))" }}>
                  <td colSpan={2}><strong>End-to-end median</strong></td>
                  <td colSpan={3}><strong>{fmtMin(v.pipeline.total_lead_time_min)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>

        <details className="appendix-fold">
          <summary>DORA with attribution · classification {v.dora_actual.classification.toUpperCase()}</summary>
          <div style={{ marginTop: 16 }}>
            <table className="wow-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Current</th>
                  <th>AI-assisted</th>
                  <th>Human-authored</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="proj-name">Deployment frequency</td>
                  <td>{v.dora_actual.deployment_frequency.current.toFixed(1)}/day</td>
                  <td>{v.dora_actual.deployment_frequency.ai_assisted_share_pct}% of deploys</td>
                  <td className="muted">—</td>
                </tr>
                <tr>
                  <td className="proj-name">Lead time</td>
                  <td>{fmtMin(v.dora_actual.lead_time_min.current)}</td>
                  <td>{fmtMin(v.dora_actual.lead_time_min.ai_assisted_median)}</td>
                  <td>{fmtMin(v.dora_actual.lead_time_min.human_authored_median)}</td>
                </tr>
                <tr>
                  <td className="proj-name">Change failure rate</td>
                  <td>{v.dora_actual.change_failure_rate_pct.current}%</td>
                  <td>{v.dora_actual.change_failure_rate_pct.ai_assisted}%</td>
                  <td>{v.dora_actual.change_failure_rate_pct.human_authored}%</td>
                </tr>
                <tr>
                  <td className="proj-name">MTTR</td>
                  <td>{fmtMin(v.dora_actual.mttr_min.current)}</td>
                  <td>{fmtMin(v.dora_actual.mttr_min.ai_assisted_median)}</td>
                  <td>{fmtMin(v.dora_actual.mttr_min.human_authored_median)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>

        <details className="appendix-fold">
          <summary>Output quality detail · conformity / rework / churn / review depth</summary>
          <div style={{ marginTop: 16 }}>
            <div className="wow-tile-row">
              <div className="wow-tile">
                <div className="wow-tile-label">Conformity rate</div>
                <div className="wow-tile-value">{v.quality_actual.conformity_rate_pct.current}%</div>
                <div className="wow-tile-sub">Lint/standards pass before commit</div>
              </div>
              <div className="wow-tile">
                <div className="wow-tile-label">Rework rate</div>
                <div className="wow-tile-value">{v.quality_actual.rework_rate_pct.current}%</div>
                <div className="wow-tile-sub">Follow-up fixes &lt;24h after merge</div>
              </div>
              <div className="wow-tile">
                <div className="wow-tile-label">14-day code churn</div>
                <div className="wow-tile-value">{v.quality_actual.code_churn_14d_pct.current}%</div>
                <div className="wow-tile-sub">New code reverted within 14 days</div>
              </div>
              <div className="wow-tile">
                <div className="wow-tile-label">Review depth</div>
                <div className="wow-tile-value">{v.quality_actual.review_depth_per_pr.current.toFixed(1)}</div>
                <div className="wow-tile-sub">Human comments per agent PR</div>
              </div>
            </div>

            <div className="wow-block" style={{ marginTop: 18 }}>
              <div className="wow-block-label">Conformity check failures this week</div>
              <div className="conformity-failures">
                {v.quality_actual.conformity_failures_this_week.map((f) => (
                  <div key={f.check} className="conformity-failure-row">
                    <code>{f.check}</code>
                    <span className="conformity-failure-count">
                      {f.sessions} session{f.sessions === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>

        <details className="appendix-fold">
          <summary>Ticket lifecycle · {v.ticket_lifecycle.length} tickets</summary>
          <div style={{ marginTop: 16 }}>
            <div className="ticket-list">
              {v.ticket_lifecycle.map((t) => (
                <div key={t.id} className={`ticket-card status-${t.status}`}>
                  <div className="ticket-card-head">
                    <div>
                      <code className="ticket-id">{t.id}</code>
                      <span className="ticket-title">{t.title}</span>
                    </div>
                    <div className={`ticket-status status-${t.status}`}>{t.status}</div>
                  </div>
                  <div className="ticket-meta">
                    <span>Cycle time <strong>{fmtMin(t.cycle_min)}</strong></span>
                    <span>AI-assist <strong>{t.ai_assisted_pct}%</strong></span>
                    {t.linked_pr && <span>PR <code>{t.linked_pr}</code></span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>

        <details className="appendix-fold">
          <summary>Cost per resolved ticket</summary>
          <div style={{ marginTop: 16 }}>
            <table className="wow-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Spend</th>
                  <th>Tickets resolved</th>
                  <th>$ / ticket</th>
                  <th>PRs merged</th>
                  <th>$ / PR</th>
                </tr>
              </thead>
              <tbody>
                {v.cost_per_resolved.map((c) => (
                  <tr key={c.project}>
                    <td className="proj-name"><code>{c.project}</code></td>
                    <td>${c.usd_total_week.toFixed(2)}</td>
                    <td>{c.tickets_resolved}</td>
                    <td>{c.usd_per_ticket ? `$${c.usd_per_ticket.toFixed(2)}` : "—"}</td>
                    <td>{c.prs_merged}</td>
                    <td>{c.usd_per_pr ? `$${c.usd_per_pr.toFixed(2)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="appendix-source-note">
          References this report draws from:{" "}
          <a href="https://dora.dev/insights/balancing-ai-tensions/" target="_blank" rel="noreferrer">
            DORA · Balancing AI tensions (March 2026)
          </a>
          ,{" "}
          <a href="https://getdx.com/whitepaper/ai-measurement-framework/" target="_blank" rel="noreferrer">
            DX AI Measurement Framework (April 2026)
          </a>
          ,{" "}
          <a href="https://resources.anthropic.com/2026-agentic-coding-trends-report" target="_blank" rel="noreferrer">
            Anthropic 2026 Agentic Coding Trends Report
          </a>
          . Wisdom from these sources informed the signal selection (which risks to monitor, which
          pairings to surface) — but no section quotes them; the report is for action, not citation.
        </div>
      </section>
    </div>
  );
}
