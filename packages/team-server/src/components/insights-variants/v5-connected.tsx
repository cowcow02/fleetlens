import type { TeamInsightReport, V5DoraActual } from "../../app/team/[slug]/insights/types";

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const CLASSIFICATION_LABEL: Record<V5DoraActual["classification"], string> = {
  elite: "Elite",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function VariantConnected({ r }: { r: TeamInsightReport }) {
  const v = r.variants.v5_extras;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v5 · Fully connected (hypothetical).</strong> What the report can show once all four
        external integrations are wired: GitHub PR + merge attribution, Linear ticket linkage,
        CI/CD + incident pipeline, code-conformance lint signal. This tab focuses on what's{" "}
        <em>newly possible</em> with integrations — the v4 base content still applies on top.
      </div>

      <div className="v5-banner">{v.banner_text}</div>

      {/* ─── End-to-end pipeline view ───────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>End-to-end <em>pipeline</em></h2>
          <div className="kicker">
            Linear ticket → session → commit → PR → review → merge → CI → deployed · every transition
            timestamped + attributed
          </div>
        </header>

        <div className="pipeline-headline">{v.pipeline.headline}</div>

        <div className="pipeline-flow">
          {v.pipeline.phases.map((ph, i) => {
            const maxMin = Math.max(...v.pipeline.phases.map((p) => p.median_min), 1);
            return (
              <div key={ph.name} className="pipeline-phase">
                <div className="pipeline-phase-step">
                  <div className="pipeline-phase-number">{i + 1}</div>
                  <div className="pipeline-phase-label">{ph.label}</div>
                </div>
                <div className="pipeline-phase-bar-track">
                  <div
                    className="pipeline-phase-bar-fill"
                    style={{ width: `${(ph.median_min / maxMin) * 100}%` }}
                  >
                    <span>{fmtMin(ph.median_min)}</span>
                  </div>
                </div>
                <div className={`pipeline-phase-delta ${ph.delta_pct_wow > 0 ? "negative" : ph.delta_pct_wow < 0 ? "positive" : ""}`}>
                  {ph.delta_pct_wow > 0 ? "+" : ""}
                  {ph.delta_pct_wow}% WoW
                </div>
                <div className="pipeline-phase-attribution">{ph.attribution_note}</div>
              </div>
            );
          })}
        </div>

        <div className="pipeline-total">
          <span className="pipeline-total-label">Median end-to-end · this week</span>
          <span className="pipeline-total-value">{fmtMin(v.pipeline.total_lead_time_min)}</span>
        </div>
      </section>

      {/* ─── DORA with attribution — populated ───────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>DORA <em>with attribution</em> · populated</h2>
          <div className="kicker">
            All four classic metrics with AI-assisted vs human-authored splits where applicable · DORA
            2026 reframing
          </div>
        </header>

        <div className="dora-classification">
          Classification this week: <strong className={`dora-class-${v.dora_actual.classification}`}>{CLASSIFICATION_LABEL[v.dora_actual.classification]}</strong>
        </div>

        <div className="dora-grid">
          <div className="dora-metric-card">
            <div className="dora-metric-label">Deployment frequency</div>
            <div className="dora-metric-value">{v.dora_actual.deployment_frequency.current.toFixed(1)}<span className="dora-metric-suffix"> / day</span></div>
            <div className={`dora-metric-delta ${v.dora_actual.deployment_frequency.delta_pct_wow > 0 ? "positive" : v.dora_actual.deployment_frequency.delta_pct_wow < 0 ? "negative" : ""}`}>
              {v.dora_actual.deployment_frequency.delta_pct_wow > 0 ? "+" : ""}
              {v.dora_actual.deployment_frequency.delta_pct_wow}% WoW
            </div>
            <div className="dora-metric-attribution">
              {v.dora_actual.deployment_frequency.ai_assisted_share_pct}% of deploys are agent-assisted
            </div>
          </div>

          <div className="dora-metric-card">
            <div className="dora-metric-label">Lead time</div>
            <div className="dora-metric-value">{fmtMin(v.dora_actual.lead_time_min.current)}</div>
            <div className="dora-metric-attribution-split">
              <div><span className="ai-tag">AI-assisted</span> {fmtMin(v.dora_actual.lead_time_min.ai_assisted_median)}</div>
              <div><span className="human-tag">Human-authored</span> {fmtMin(v.dora_actual.lead_time_min.human_authored_median)}</div>
            </div>
          </div>

          <div className="dora-metric-card">
            <div className="dora-metric-label">Change failure rate</div>
            <div className="dora-metric-value">{v.dora_actual.change_failure_rate_pct.current}%</div>
            <div className="dora-metric-attribution-split">
              <div><span className="ai-tag">AI-assisted</span> {v.dora_actual.change_failure_rate_pct.ai_assisted}%</div>
              <div><span className="human-tag">Human-authored</span> {v.dora_actual.change_failure_rate_pct.human_authored}%</div>
            </div>
          </div>

          <div className="dora-metric-card">
            <div className="dora-metric-label">MTTR</div>
            <div className="dora-metric-value">{fmtMin(v.dora_actual.mttr_min.current)}</div>
            <div className="dora-metric-attribution-split">
              <div><span className="ai-tag">AI-assisted</span> {fmtMin(v.dora_actual.mttr_min.ai_assisted_median)}</div>
              <div><span className="human-tag">Human-authored</span> {fmtMin(v.dora_actual.mttr_min.human_authored_median)}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Output quality watch · populated ─────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Output <em>quality</em> · populated</h2>
          <div className="kicker">
            Context-engineering metrics from Fowler 2026 · now flowing from the lint + GitHub PR integrations
          </div>
        </header>

        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Conformity rate</div>
            <div className="wow-tile-value">{v.quality_actual.conformity_rate_pct.current}%</div>
            <div className={`wow-tile-delta ${v.quality_actual.conformity_rate_pct.delta_pp_wow > 0 ? "positive" : v.quality_actual.conformity_rate_pct.delta_pp_wow < 0 ? "negative" : ""}`}>
              {v.quality_actual.conformity_rate_pct.delta_pp_wow > 0 ? "+" : ""}
              {v.quality_actual.conformity_rate_pct.delta_pp_wow}pp WoW
            </div>
            <div className="wow-tile-sub">Agent output passing team lint/standards before commit</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Rework rate</div>
            <div className="wow-tile-value">{v.quality_actual.rework_rate_pct.current}%</div>
            <div className={`wow-tile-delta ${v.quality_actual.rework_rate_pct.delta_pp_wow < 0 ? "positive" : v.quality_actual.rework_rate_pct.delta_pp_wow > 0 ? "negative" : ""}`}>
              {v.quality_actual.rework_rate_pct.delta_pp_wow > 0 ? "+" : ""}
              {v.quality_actual.rework_rate_pct.delta_pp_wow}pp WoW
            </div>
            <div className="wow-tile-sub">PRs with follow-up fixes &lt;24h after merge</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">14-day code churn</div>
            <div className="wow-tile-value">{v.quality_actual.code_churn_14d_pct.current}%</div>
            <div className={`wow-tile-delta ${v.quality_actual.code_churn_14d_pct.delta_pp_wow < 0 ? "positive" : v.quality_actual.code_churn_14d_pct.delta_pp_wow > 0 ? "negative" : ""}`}>
              {v.quality_actual.code_churn_14d_pct.delta_pp_wow > 0 ? "+" : ""}
              {v.quality_actual.code_churn_14d_pct.delta_pp_wow}pp WoW
            </div>
            <div className="wow-tile-sub">New code reverted within 14 days</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Review depth</div>
            <div className="wow-tile-value">{v.quality_actual.review_depth_per_pr.current.toFixed(1)}</div>
            <div className={`wow-tile-delta ${v.quality_actual.review_depth_per_pr.delta_pct_wow > 0 ? "positive" : v.quality_actual.review_depth_per_pr.delta_pct_wow < 0 ? "negative" : ""}`}>
              {v.quality_actual.review_depth_per_pr.delta_pct_wow > 0 ? "+" : ""}
              {v.quality_actual.review_depth_per_pr.delta_pct_wow}% WoW
            </div>
            <div className="wow-tile-sub">Human comments per agent-authored PR (rising = healthy oversight)</div>
          </div>
        </div>

        <div className="wow-block" style={{ marginTop: 24 }}>
          <div className="wow-block-label">Conformity-check failures this week</div>
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
      </section>

      {/* ─── Ticket lifecycle ──────────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Ticket <em>lifecycle</em></h2>
          <div className="kicker">Linear tickets resolved this week · cycle time + AI-assist share + linked session(s) + PR</div>
        </header>

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
                {t.linked_pr && (
                  <span>
                    PR <code>{t.linked_pr}</code>
                  </span>
                )}
              </div>
              <div className="ticket-sessions">
                Linked sessions: {t.linked_sessions.map((s) => <code key={s}>{s}</code>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Case-study attribution overlay ───────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Case-study <em>attribution</em> overlay</h2>
          <div className="kicker">Each opted-in session now links to its ticket(s), PR(s), CI result, and deployment status</div>
        </header>

        <table className="wow-table">
          <thead>
            <tr>
              <th>Session</th>
              <th>Tickets</th>
              <th>PRs</th>
              <th>Review</th>
              <th>CI</th>
              <th>Deployed?</th>
            </tr>
          </thead>
          <tbody>
            {v.case_study_attribution.map((cs) => (
              <tr key={cs.case_study_id}>
                <td><code>{cs.case_study_id}</code></td>
                <td>{cs.ticket_ids.map((t) => <code key={t}>{t}</code>)}</td>
                <td>
                  {cs.pr_links.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    cs.pr_links.map((p) => (
                      <div key={p.label} className={`pr-link status-${p.status}`}>
                        <code>{p.label}</code> · {p.status}
                      </div>
                    ))
                  )}
                </td>
                <td>
                  {cs.pr_links.length === 0 ? <span className="muted">—</span> :
                    cs.pr_links.reduce((s, p) => s + p.review_comments, 0)} comments
                </td>
                <td>
                  <span className={`ci-badge ci-${cs.ci_result}`}>{cs.ci_result}</span>
                </td>
                <td>{cs.deployed ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Cost per resolved ticket ────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Cost per <em>resolved ticket</em></h2>
          <div className="kicker">
            With Linear linkage wired, cost-per-ticket replaces the proxy "cost-per-shipped-PR" — same idea, closer to value
          </div>
        </header>

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
      </section>

      {/* ─── Newly answerable questions ──────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>What integrations <em>newly let us answer</em></h2>
          <div className="kicker">Six questions the v4 report can't answer · all six become possible with the four integrations</div>
        </header>

        <div className="newly-answerable">
          {v.newly_answerable_questions.map((q, i) => (
            <div key={i} className="qa-card">
              <div className="qa-q">{q.question}</div>
              <div className="qa-a">{q.answer}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Closing ──────────────────────────────────────────── */}
      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Closing <em>reflections</em></h2>
        </header>
        <article className="story-article">
          {v.v5_closing.map((p, i) => (
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
    </div>
  );
}
