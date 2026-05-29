import { STATUS_LABEL, type MetricProvenance } from "../lib/metric-provenance";

// Small ⓘ affordance shown in Explain mode. Pure markup + CSS hover/focus
// popover (.metric-explain in globals.css) so it works in both server and
// client components with no JS.
export function ExplainBadge({ p }: { p: MetricProvenance | null }) {
  if (!p) return null;
  return (
    <span className="metric-explain" tabIndex={0} aria-label="Metric explanation">
      <span className="metric-explain-dot" aria-hidden>
        &#9432;
      </span>
      <span className="metric-explain-pop" role="tooltip">
        <span className="mep-desc">{p.description}</span>
        <span className="mep-row">
          <span className="mep-k">Source</span>
          <span>{p.source}</span>
        </span>
        <span className="mep-row">
          <span className="mep-k">Status</span>
          <span className={`mep-status mep-status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
        </span>
        <span className="mep-row">
          <span className="mep-k">Method</span>
          <span>{p.llm ? `LLM-generated — ${p.llm}` : "Deterministic — computed in code, no model."}</span>
        </span>
      </span>
    </span>
  );
}
