import type { TeamInsightReport, V5DoraUseCase } from "../../app/team/[slug]/insights/types";

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function PrimitiveDots({ value }: { value: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <span className="primitive-dots" title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`primitive-dot ${n <= value ? "filled" : ""}`} />
      ))}
    </span>
  );
}

function UseCaseRow({ uc }: { uc: V5DoraUseCase }) {
  return (
    <tr>
      <td className="usecase-name">{uc.name}</td>
      <td className="usecase-mapping"><code>{uc.our_mapping}</code></td>
      <td className="usecase-num">{uc.sessions}</td>
      <td className="usecase-num">{uc.hours.toFixed(1)}h</td>
      <td className="usecase-autonomy"><PrimitiveDots value={uc.ai_autonomy_avg} /></td>
      <td className="usecase-num">{uc.success_rate_pct}%</td>
      <td className="usecase-note">{uc.notable_signal ?? ""}</td>
    </tr>
  );
}

export function VariantConnected({ r }: { r: TeamInsightReport }) {
  const v = r.variants.v5_extras;
  const n = v.dora_narrative;

  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v5 · Balancing AI tensions.</strong> Reshaped to follow the narrative arc of DORA's
        March 2026 article{" "}
        <a
          href="https://dora.dev/insights/balancing-ai-tensions/"
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent)" }}
        >
          Balancing AI tensions
        </a>
        . Same data as v4 + the integration-hypothetical, but organised top-down around the article's
        spine: opening paradox → AI as amplifier → 10-use-case state of the SDLC → where AI drove
        value → three tensions (velocity push/pull, expertise paradox, workflow gap) → practical
        insights via SEQ / SPACE / H.E.A.R.T. / VSM → engineering rigor still matters.
      </div>

      {/* ─── Section 1: Opening ─────────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Opening · the <em>paradox</em></h2>
          <div className="kicker">"90%+ adoption · 80% report gains · the impact is not linear"</div>
        </header>

        <div className="dora-opening-headline">{n.opening.headline}</div>

        <div className="opening-paradox-row">
          <div className="paradox-side throughput">
            <div className="paradox-label">Throughput</div>
            <div className="paradox-value">{n.opening.throughput_signal}</div>
          </div>
          <div className="paradox-vs">↔</div>
          <div className="paradox-side instability">
            <div className="paradox-label">Instability</div>
            <div className="paradox-value">{n.opening.instability_signal}</div>
          </div>
        </div>

        <div className="opening-adoption-row">
          <div>
            <strong>{n.opening.used_pct}%</strong> of sessions used AI
          </div>
          <div>
            <strong>{n.opening.perceived_productive_pct}%</strong> perceived productivity (proxy: helpfulness-essential + helpful share)
          </div>
        </div>
      </section>

      {/* ─── Section 2: AI as amplifier ─────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>AI as <em>amplifier</em></h2>
          <div className="kicker">
            Magnifies organisational strengths and dysfunctions equally · higher adoption correlates
            with both
          </div>
        </header>

        <div className="amplifier-headline">{n.amplifier.headline}</div>

        <div className="amplifier-grid">
          <div className="amplifier-side strengths">
            <div className="amplifier-side-label">
              <span className="amplifier-side-sign">↑</span> Strengths the team is amplifying
            </div>
            {n.amplifier.strengths_amplified.map((s, i) => (
              <div key={i} className="amplifier-item">
                <div className="amplifier-observation">{s.observation}</div>
                <div className="amplifier-metric">{s.supporting_metric}</div>
              </div>
            ))}
          </div>
          <div className="amplifier-side dysfunctions">
            <div className="amplifier-side-label">
              <span className="amplifier-side-sign">↓</span> Dysfunctions the team is amplifying
            </div>
            {n.amplifier.dysfunctions_amplified.map((s, i) => (
              <div key={i} className="amplifier-item">
                <div className="amplifier-observation">{s.observation}</div>
                <div className="amplifier-metric">{s.supporting_metric}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Section 3: 10 use cases ────────────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>The state of AI in the <em>SDLC</em> · 10 use cases</h2>
          <div className="kicker">
            The DORA article's 10-use-case taxonomy, applied to our team's data · zero use of "writing
            docs" is the most visible underweight signal
          </div>
        </header>

        <table className="usecase-table">
          <thead>
            <tr>
              <th>Use case</th>
              <th>Our mapping</th>
              <th>Sessions</th>
              <th>Hours</th>
              <th>AI autonomy avg</th>
              <th>Success rate</th>
              <th>Notable signal</th>
            </tr>
          </thead>
          <tbody>
            {n.use_cases.map((uc) => (
              <UseCaseRow key={uc.name} uc={uc} />
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Section 4: Where AI drove immediate value ───────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Where AI drove <em>immediate value</em></h2>
          <div className="kicker">
            Concrete wins anchored to opted-in case studies · the throughput side of the paradox,
            named with specifics
          </div>
        </header>

        <div className="value-headline">{n.immediate_value.headline}</div>

        <div className="value-wins-grid">
          {n.immediate_value.wins.map((w, i) => (
            <div key={i} className="value-win">
              <div className="value-win-head">
                <span className="value-win-member">{w.member}</span>
                {w.ticket && <code className="value-win-ticket">{w.ticket}</code>}
              </div>
              <div className="value-win-title">{w.title}</div>
              <div className="value-win-detail">{w.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Section 5: The three tensions ───────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>The hidden taxes · three <em>tensions</em></h2>
          <div className="kicker">
            The article's central frame · each tension here is matched to our data + a canonical session
          </div>
        </header>

        {n.tensions.map((t) => (
          <div key={t.number} className="tension-card">
            <div className="tension-number">Tension {t.number}</div>
            <h3 className="tension-name">{t.name}</h3>
            <blockquote className="tension-quote">"{t.article_quote}"</blockquote>
            <div className="tension-source">— DORA · Balancing AI tensions, March 2026 (Google engineer quote)</div>

            <div className="tension-summary">{t.our_data_summary}</div>

            <div className="tension-metrics-grid">
              {t.signal_metrics.map((m, i) => (
                <div key={i} className="tension-metric">
                  <div className="tension-metric-label">{m.label}</div>
                  <div className="tension-metric-value">{m.value}</div>
                  {m.note && <div className="tension-metric-note">{m.note}</div>}
                </div>
              ))}
            </div>

            <div className="tension-example">
              <div className="tension-example-label">Canonical example on this team</div>
              <div className="tension-example-session">{t.canonical_example.session_label}</div>
              <div className="tension-example-explanation">{t.canonical_example.explanation}</div>
            </div>
          </div>
        ))}
      </section>

      {/* ─── Section 6: Practical insights ──────────────────────────── */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Practical <em>insights</em></h2>
          <div className="kicker">
            The article's four recommended frameworks · each mapped against our data this week
          </div>
        </header>

        {n.practical_insights.map((fw) => (
          <div key={fw.framework} className="framework-card">
            <div className="framework-card-head">
              <h3 className="framework-card-name">
                <span className="framework-card-acronym">{fw.framework}</span>
                <span className="framework-card-full">{fw.full_name}</span>
              </h3>
            </div>
            <div className="framework-card-purpose">{fw.purpose}</div>

            <div className="framework-mapping-list">
              {fw.our_mapping.map((m, i) => (
                <div key={i} className="framework-mapping-row">
                  <div className="framework-mapping-dim">{m.dimension}</div>
                  <div className="framework-mapping-value">{m.current_value}</div>
                  {m.note && <div className="framework-mapping-note">{m.note}</div>}
                </div>
              ))}
            </div>

            <a
              className="framework-citation"
              href={fw.citation.href}
              target="_blank"
              rel="noreferrer"
            >
              {fw.citation.label} →
            </a>
          </div>
        ))}
      </section>

      {/* ─── Section 7: Conclusion ──────────────────────────────────── */}
      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Engineering rigor still <em>matters</em></h2>
          <div className="kicker">
            The article's closing frame · applied to this team's specific tradeoffs
          </div>
        </header>

        <article className="story-article">
          {n.conclusion_paragraphs.map((p, i) => (
            <section key={i} className="story-section">
              {p.heading && <h3 className="story-heading">{p.heading}</h3>}
              <p className="story-body">{p.body}</p>
            </section>
          ))}
        </article>

        <div className="closing-citation-block">
          Narrative spine drawn from{" "}
          <a href={n.closing_citation.href} target="_blank" rel="noreferrer">
            {n.closing_citation.label}
          </a>{" "}
          (published {n.closing_citation.published}).
        </div>
      </section>

      {/* ─── Appendix: the integration-hypothetical data, kept as reference ─ */}
      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Appendix · hypothetical with <em>all integrations</em></h2>
          <div className="kicker">
            The end-to-end pipeline, ticket lifecycle, and quality numbers from v5's earlier version —
            kept here as the data substrate the narrative above draws from
          </div>
        </header>

        <h3 className="variant-subhead">End-to-end pipeline</h3>
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

        <h3 className="variant-subhead" style={{ marginTop: 28 }}>Ticket lifecycle (Linear)</h3>
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
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
