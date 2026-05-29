"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATUS_LABEL, type MetricProvenance } from "../lib/metric-provenance";

// ⓘ affordance shown in Explain mode. The popover is portaled to <body> and
// positioned fixed from the badge's rect, so it can never be clipped by an
// ancestor's overflow/stacking context (a plain CSS-hover popover was getting
// trapped inside the card). Works in server or client trees — it's a client
// island either way.
export function ExplainBadge({ p }: { p: MetricProvenance | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 340;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);
  const hide = useCallback(() => setPos(null), []);

  if (!p) return null;
  return (
    <span
      ref={ref}
      className="metric-explain"
      tabIndex={0}
      aria-label="Metric explanation"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span className="metric-explain-dot" aria-hidden>
        &#9432;
      </span>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <span className="metric-explain-pop" role="tooltip" style={{ top: pos.top, left: pos.left }}>
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
          </span>,
          document.body,
        )}
    </span>
  );
}
