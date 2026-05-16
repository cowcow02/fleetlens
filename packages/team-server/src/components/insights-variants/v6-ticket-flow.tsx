import type {
  TeamInsightReport,
  V6AllocationRow,
  V6AnswerableQuestion,
  V6CaseStudy,
  V6PhaseId,
  V6PhaseSummary,
  V6TicketJourney,
  V6WorkflowMapping,
} from "../../app/team/[slug]/insights/types";

const PHASE_LABEL: Record<V6PhaseId, string> = {
  spec: "Spec",
  ready: "Ready",
  implementation: "Implementation",
  "code-review": "Code review",
  qa: "QA",
  launch: "Launch",
};

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtStamp(s: string): string {
  return new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deltaText(delta: number): string {
  if (delta === 0) return "0%";
  return `${delta > 0 ? "+" : ""}${delta}%`;
}

function phaseClass(phase: V6PhaseId): string {
  return `phase-${phase.replace("-", "")}`;
}

function DataPill({ type }: { type: V6AnswerableQuestion["capturability"] | V6CaseStudy["evidence_level"] }) {
  const label: Record<string, string> = {
    "ticket-integration": "Ticket integration",
    "individual-telemetry": "Individual telemetry",
    "opt-in-session": "Opt-in session",
    "needs-workflow-mapping": "Workflow mapping",
    "ticket-only": "Ticket only",
    "ticket-plus-telemetry": "Ticket + telemetry",
  };
  return <span className={`v6-data-pill data-${type}`}>{label[type] ?? type}</span>;
}

export function V6PhaseSummaryCard({ phase, maxScore }: { phase: V6PhaseSummary; maxScore: number }) {
  const barWidth = Math.max(4, (phase.bottleneck_score / Math.max(maxScore, 1)) * 100);
  return (
    <div className={`v6-phase-card ${phaseClass(phase.phase)}`}>
      <div className="v6-phase-card-head">
        <div>
          <div className="v6-phase-kicker">{PHASE_LABEL[phase.phase]}</div>
          <div className="v6-phase-title">{phase.label}</div>
        </div>
        <span className={`v6-delta ${phase.delta_pct > 0 ? "negative" : "positive"}`}>
          {deltaText(phase.delta_pct)}
        </span>
      </div>
      <div className="v6-phase-metric-row">
        <div>
          <span className="v6-phase-metric-value">{fmtMin(phase.median_min)}</span>
          <span className="v6-phase-metric-label">median phase</span>
        </div>
        <div>
          <span className="v6-phase-metric-value">{fmtMin(phase.agent_time_min)}</span>
          <span className="v6-phase-metric-label">agent time</span>
        </div>
        <div>
          <span className="v6-phase-metric-value">{phase.submitted_sections}</span>
          <span className="v6-phase-metric-label">sections</span>
        </div>
      </div>
      <div className="v6-bottleneck-track">
        <span style={{ width: `${barWidth}%` }} />
      </div>
      <p className="v6-phase-narrative">{phase.narrative}</p>
    </div>
  );
}

export function V6WorkflowMappingTable({ rows }: { rows: V6WorkflowMapping[] }) {
  return (
    <table className="v6-workflow-table">
      <thead>
        <tr>
          <th>Source</th>
          <th>Raw status</th>
          <th>Normalized phase</th>
          <th>Confidence</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.source}-${row.raw_status}-${i}`}>
            <td>{row.source}</td>
            <td className="v6-raw-status">{row.raw_status}</td>
            <td>
              <span className={`v6-phase-chip ${phaseClass(row.normalized_phase)}`}>
                {PHASE_LABEL[row.normalized_phase]}
              </span>
            </td>
            <td>
              <span className={`v6-confidence confidence-${row.confidence}`}>{row.confidence}</span>
            </td>
            <td className="v6-table-note">{row.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function V6TicketJourneyCard({ ticket }: { ticket: V6TicketJourney }) {
  const visualTotal = ticket.phase_spans.reduce((sum, p) => sum + Math.sqrt(Math.max(p.duration_min, 1)), 0);
  const sections = ticket.phase_spans.flatMap((p) =>
    p.submitted_sections.map((s) => ({ ...s, phase: p.phase, phaseLabel: p.label }))
  );

  return (
    <article className={`v6-ticket-card outcome-${ticket.outcome}`}>
      <div className="v6-ticket-head">
        <div>
          <div className="v6-ticket-id">{ticket.id} · {ticket.source} · {ticket.owner}</div>
          <h3>{ticket.title}</h3>
        </div>
        <div className="v6-ticket-total">
          <span>{fmtMin(ticket.total_min)}</span>
          <em className={ticket.delta_vs_prior_pct > 0 ? "negative" : "positive"}>
            {deltaText(ticket.delta_vs_prior_pct)}
          </em>
        </div>
      </div>

      <div className="v6-ticket-impl-window">
        Implementation window: <strong>{fmtMin(ticket.implementation_window_min)}</strong>
        <span>previous similar tickets: {fmtMin(ticket.previous_implementation_window_min)}</span>
      </div>

      <div className="v6-ticket-rail">
        {ticket.phase_spans.map((span) => {
          const visual = Math.sqrt(Math.max(span.duration_min, 1));
          return (
            <div
              key={`${ticket.id}-${span.phase}-${span.start}`}
              className={`v6-ticket-span ${phaseClass(span.phase)}`}
              style={{ flexBasis: `${(visual / visualTotal) * 100}%` }}
            >
              <div className="v6-ticket-span-label">{PHASE_LABEL[span.phase]}</div>
              <div className="v6-ticket-span-duration">{fmtMin(span.duration_min)}</div>
              <div className="v6-ticket-span-agent">{fmtMin(span.agent_time_min)} agent</div>
              {span.submitted_sections.length > 0 && (
                <div className="v6-ticket-section-dots">
                  {span.submitted_sections.map((s, i) => (
                    <span
                      key={`${s.timestamp}-${i}`}
                      className={`v6-ticket-section-dot ${s.sensitivity}`}
                      title={`${fmtStamp(s.timestamp)} · ${s.label}`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="v6-ticket-insight">{ticket.insight}</p>

      <div className="v6-section-marker-list">
        {sections.map((s, i) => (
          <div key={`${s.timestamp}-${i}`} className="v6-section-marker-row">
            <span>{fmtStamp(s.timestamp)}</span>
            <strong>{s.member}</strong>
            <em>{s.phaseLabel}</em>
            <p>{s.label}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function V6TrendChart({ rows }: { rows: TeamInsightReport["variants"]["v6_extras"]["implementation_trend"] }) {
  const max = Math.max(...rows.map((r) => r.median_total_min), 1);
  return (
    <div className="v6-trend-grid">
      {rows.map((row) => (
        <div key={row.period} className="v6-trend-col">
          <div className="v6-trend-bars">
            <span
              className="v6-trend-total"
              style={{ height: `${Math.max(12, (row.median_total_min / max) * 150)}px` }}
            />
            <span
              className="v6-trend-implementation"
              style={{ height: `${Math.max(8, (row.median_implementation_min / max) * 150)}px` }}
            />
          </div>
          <div className="v6-trend-label">{row.period}</div>
          <div className="v6-trend-value">{fmtMin(row.median_implementation_min)} impl</div>
          <div className="v6-trend-sub">{row.review_qa_share_pct}% review+QA</div>
        </div>
      ))}
    </div>
  );
}

export function V6AllocationRowCard({ row }: { row: V6AllocationRow }) {
  const total = Math.max(1, row.spec_min + row.implementation_min + row.review_min + row.qa_min + row.launch_min);
  const pieces: { phase: V6PhaseId; value: number }[] = [
    { phase: "spec", value: row.spec_min },
    { phase: "implementation", value: row.implementation_min },
    { phase: "code-review", value: row.review_min },
    { phase: "qa", value: row.qa_min },
    { phase: "launch", value: row.launch_min },
  ];

  return (
    <div className="v6-allocation-row">
      <div className="v6-allocation-member">
        <strong>{row.member}</strong>
        <span>{PHASE_LABEL[row.dominant_phase]} dominant</span>
      </div>
      <div className="v6-allocation-bar">
        {pieces.map((p) => (
          <span
            key={p.phase}
            className={phaseClass(p.phase)}
            style={{ width: `${(p.value / total) * 100}%` }}
            title={`${PHASE_LABEL[p.phase]} · ${fmtMin(p.value)}`}
          />
        ))}
      </div>
      <p>{row.note}</p>
    </div>
  );
}

export function V6CaseStudyCard({ c }: { c: V6CaseStudy }) {
  return (
    <article className={`v6-case-card ${phaseClass(c.phase)}`}>
      <div className="v6-case-head">
        <div>
          <div className="v6-case-meta">{c.ticket_id} · {c.member} · {c.session_window}</div>
          <h3>{c.title}</h3>
        </div>
        <DataPill type={c.evidence_level} />
      </div>
      <div className="v6-case-two-col">
        <div>
          <div className="v6-case-label">What happened</div>
          <p>{c.what_happened}</p>
        </div>
        <div>
          <div className="v6-case-label">Why it matters</div>
          <p>{c.why_it_matters}</p>
        </div>
      </div>
    </article>
  );
}

function QuestionRow({ q }: { q: V6AnswerableQuestion }) {
  return (
    <div className="v6-question-row">
      <div>
        <h3>{q.question}</h3>
        <p>{q.data_needed}</p>
      </div>
      <div className="v6-question-answer">{q.answer_if_connected}</div>
      <DataPill type={q.capturability} />
    </div>
  );
}

export function VariantTicketFlow({ r }: { r: TeamInsightReport }) {
  const v = r.variants.v6_extras;
  const maxScore = Math.max(...v.phase_summaries.map((p) => p.bottleneck_score), 1);

  return (
    <div className="variant-frame v6-frame">
      <div className="variant-intro">
        <strong>v6 · Ticket live journey.</strong> {v.premise}
      </div>

      <section className="combined-section v6-hero-section">
        <header className="combined-section-head">
          <h2>Ticket lifecycle as the <em>first story</em></h2>
          <div className="kicker">Ticket phase timestamps first · Codex telemetry second · opt-in sessions explain the mechanism</div>
        </header>
        <div className="v6-hero-grid">
          <div className="v6-hero-copy">
            <div className="v6-hero-headline">{v.headline}</div>
            <p>{v.universal_workflow_note}</p>
          </div>
          <div className="v6-layer-stack">
            <div><strong>1</strong><span>Ticket phase journey</span><em>status changes, assignee shifts, PR and release timestamps</em></div>
            <div><strong>2</strong><span>Individual telemetry overlay</span><em>active segments, agent time, linked sessions, phase-local work</em></div>
            <div><strong>3</strong><span>Opt-in case studies</span><em>submitted sections explain why a ticket compressed or stalled</em></div>
          </div>
        </div>
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Workflow <em>mapper</em></h2>
          <div className="kicker">Every project can use a different game board; v6 starts by mapping raw statuses into normalized phases</div>
        </header>
        <V6WorkflowMappingTable rows={v.workflow_mappings} />
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Where time <em>went</em></h2>
          <div className="kicker">Phase distribution across tickets · bottleneck score includes duration, growth, and handoff pressure</div>
        </header>
        <div className="v6-phase-grid">
          {v.phase_summaries.map((phase) => (
            <V6PhaseSummaryCard key={phase.phase} phase={phase} maxScore={maxScore} />
          ))}
        </div>
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Ticket live <em>journeys</em></h2>
          <div className="kicker">Each rail combines ticket state shifts with submitted session sections inside the same timeline</div>
        </header>
        <div className="v6-ticket-stack">
          {v.ticket_journeys.map((ticket) => (
            <V6TicketJourneyCard key={ticket.id} ticket={ticket} />
          ))}
        </div>
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>The implementation window <em>compressed</em></h2>
          <div className="kicker">Median implementation got smaller while review + QA became a larger share of total ticket time</div>
        </header>
        <V6TrendChart rows={v.implementation_trend} />
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Where each member's agent time <em>landed</em></h2>
          <div className="kicker">Not a productivity ranking · a phase-allocation map for coaching and workflow design</div>
        </header>
        <div className="v6-allocation-stack">
          {v.allocation.map((row) => (
            <V6AllocationRowCard key={row.member} row={row} />
          ))}
        </div>
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Submitted sessions explain <em>why</em></h2>
          <div className="kicker">Opted-in sections turn ticket timing into reproducible team practice</div>
        </header>
        <div className="v6-case-grid">
          {v.case_studies.map((c) => (
            <V6CaseStudyCard key={`${c.ticket_id}-${c.title}`} c={c} />
          ))}
        </div>
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>What becomes <em>answerable</em></h2>
          <div className="kicker">Judge the usefulness of v6 by these questions, not by raw event counts</div>
        </header>
        <div className="v6-question-stack">
          {v.answerable_questions.map((q) => (
            <QuestionRow key={q.question} q={q} />
          ))}
        </div>
      </section>
    </div>
  );
}
