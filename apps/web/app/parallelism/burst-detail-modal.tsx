"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GanttDay,
  GanttSession,
  ParallelismBurst,
} from "@claude-lens/parser";
import { formatDuration, prettyProjectName } from "@/lib/format";
import { OutcomePill } from "@/components/outcome-pill";
import { fmtTime, sessionColor, stripXml } from "./gantt-chart-utils";
import type { SessionEntrySummary } from "./gantt-chart";

export function BurstDetailModal({
  burst,
  gantt,
  sessionEntries,
  onClose,
  onShowInTimeline,
}: {
  burst: ParallelismBurst;
  gantt: GanttDay;
  sessionEntries: Record<string, SessionEntrySummary>;
  onClose: () => void;
  onShowInTimeline: () => void;
}) {
  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Track which session card should be visually focused. Clicking a
  // numbered track badge in the mini-Gantt sets this, scrolls the card
  // into view, and paints it with a highlighted border.
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  // Resolve involved sessions from the Gantt index, preserving the order
  // from the burst's sessionIds list.
  const sessionById = useMemo(() => {
    const m = new Map<string, GanttSession>();
    for (const s of gantt.sessions) m.set(s.id, s);
    return m;
  }, [gantt]);

  const involved: GanttSession[] = burst.sessionIds
    .map((id) => sessionById.get(id))
    .filter((s): s is GanttSession => !!s);

  // Sort by start time ascending so the timeline reads top-to-bottom.
  involved.sort((a, b) => a.startMs - b.startMs);

  const handleFocusTrack = (sessionId: string) => {
    setFocusedSessionId(sessionId);
    const card = cardRefs.current.get(sessionId);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // Build the mini-Gantt time range: expand to show the full day span of
  // involved sessions so you can tell "this session started way earlier,
  // the burst was just a slice". Padded by 15 min each side.
  const GANTT_PAD_MS = 15 * 60 * 1000;
  const rawEarliest = Math.min(
    burst.startMs,
    ...involved.map((s) => s.startMs),
  );
  const rawLatest = Math.max(
    burst.endMs,
    ...involved.map((s) => s.endMs),
  );
  const rangeStartMs = rawEarliest - GANTT_PAD_MS;
  const rangeEndMs = rawLatest + GANTT_PAD_MS;
  const rangeDuration = rangeEndMs - rangeStartMs;

  // Layout for the mini-Gantt.
  const MINI_CHART_WIDTH = 510;
  const MINI_ROW_HEIGHT = 22;
  const MINI_ROW_GAP = 3;
  const MINI_HEADER_HEIGHT = 22;
  // Left column for numbered track badges (1, 2, 3 …). Clicks here focus
  // the corresponding session card in the list below.
  const NUMBER_COL_WIDTH = 24;
  const miniSvgWidth = NUMBER_COL_WIDTH + MINI_CHART_WIDTH;
  const miniBodyHeight =
    involved.length * (MINI_ROW_HEIGHT + MINI_ROW_GAP) - MINI_ROW_GAP;
  const miniTotalHeight = MINI_HEADER_HEIGHT + miniBodyHeight + 6;

  const msToMiniX = (ms: number): number => {
    return ((ms - rangeStartMs) / rangeDuration) * MINI_CHART_WIDTH;
  };

  // Hour tick marks within the mini-gantt range.
  const miniHourMarks: number[] = [];
  {
    const cur = new Date(rangeStartMs);
    cur.setMinutes(0, 0, 0);
    if (cur.getTime() < rangeStartMs) cur.setHours(cur.getHours() + 1);
    while (cur.getTime() <= rangeEndMs) {
      miniHourMarks.push(cur.getTime());
      cur.setHours(cur.getHours() + 1);
    }
  }

  // Burst shaded band (the actual concurrency window).
  const burstX1 = msToMiniX(burst.startMs);
  const burstX2 = msToMiniX(burst.endMs);

  // For each session, compute "active time inside the burst window"
  // by clipping its segments to [burst.startMs, burst.endMs] and summing.
  const activeInBurst = (s: GanttSession): number => {
    let sum = 0;
    for (const seg of s.segments) {
      const a = Math.max(seg.startMs, burst.startMs);
      const b = Math.min(seg.endMs, burst.endMs);
      if (b > a) sum += b - a;
    }
    return sum;
  };

  const totalDurationMs = burst.endMs - burst.startMs;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="burst-detail-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--af-surface-elevated)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 12,
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 22px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 10px",
                  borderRadius: 10,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "white",
                  background: burst.crossProject
                    ? "rgba(167, 139, 250, 0.95)"
                    : "rgba(45, 212, 191, 0.95)",
                }}
              >
                ×{burst.peak} peak
              </span>
              {burst.crossProject && (
                <span
                  style={{
                    fontSize: 9,
                    color: "rgba(167, 139, 250, 1)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    fontWeight: 700,
                  }}
                >
                  cross-project
                </span>
              )}
            </div>
            <h2
              id="burst-detail-title"
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {fmtTime(burst.startMs)}–{fmtTime(burst.endMs)}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {formatDuration(totalDurationMs)}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  color: "var(--af-text-tertiary)",
                }}
              >
                · {involved.length} session{involved.length === 1 ? "" : "s"}
              </span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onShowInTimeline}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--af-text-secondary)",
              cursor: "pointer",
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
            title="Pin this burst on the main timeline and close"
          >
            Show in timeline →
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text-tertiary)",
              fontSize: 24,
              lineHeight: 1,
              cursor: "pointer",
              padding: 0,
              width: 28,
              height: 28,
            }}
          >
            ×
          </button>
        </div>

        {/* Body — scrolls */}
        <div style={{ overflow: "auto", padding: "18px 22px" }}>
          {/* Mini-Gantt */}
          <div
            style={{
              fontSize: 10,
              color: "var(--af-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 8,
              fontWeight: 600,
            }}
          >
            Timeline (shaded = burst window)
          </div>
          <div
            style={{
              background: "var(--af-surface)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              padding: "8px 10px",
              overflow: "auto",
            }}
          >
            <svg
              width={miniSvgWidth}
              height={miniTotalHeight}
              style={{ display: "block" }}
            >
              {/* Numbered track badges (left column, not translated) */}
              {involved.map((s, i) => {
                const y = MINI_HEADER_HEIGHT + i * (MINI_ROW_HEIGHT + MINI_ROW_GAP);
                const cy = y + MINI_ROW_HEIGHT / 2;
                const color = sessionColor(s);
                const isFocused = focusedSessionId === s.id;
                return (
                  <g
                    key={`num-${s.id}`}
                    onClick={() => handleFocusTrack(s.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{`Track ${i + 1} — click to focus in list below`}</title>
                    <circle
                      cx={NUMBER_COL_WIDTH / 2}
                      cy={cy}
                      r={9}
                      fill={isFocused ? color : "var(--af-surface-elevated)"}
                      stroke={color}
                      strokeWidth={isFocused ? 2 : 1.5}
                    />
                    <text
                      x={NUMBER_COL_WIDTH / 2}
                      y={cy + 3.5}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill={isFocused ? "#fff" : "var(--af-text)"}
                      style={{ pointerEvents: "none" }}
                    >
                      {i + 1}
                    </text>
                  </g>
                );
              })}

              {/* Chart content — translated right of the number column */}
              <g transform={`translate(${NUMBER_COL_WIDTH}, 0)`}>
                {/* Burst shaded band */}
                <rect
                  x={burstX1}
                  y={0}
                  width={Math.max(burstX2 - burstX1, 2)}
                  height={miniTotalHeight}
                  fill={
                    burst.crossProject
                      ? "rgba(167, 139, 250, 0.14)"
                      : "rgba(45, 212, 191, 0.14)"
                  }
                />
                {/* Burst band outline */}
                <line
                  x1={burstX1}
                  x2={burstX1}
                  y1={0}
                  y2={miniTotalHeight}
                  stroke={
                    burst.crossProject
                      ? "rgba(167, 139, 250, 0.7)"
                      : "rgba(45, 212, 191, 0.7)"
                  }
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
                <line
                  x1={burstX2}
                  x2={burstX2}
                  y1={0}
                  y2={miniTotalHeight}
                  stroke={
                    burst.crossProject
                      ? "rgba(167, 139, 250, 0.7)"
                      : "rgba(45, 212, 191, 0.7)"
                  }
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />

                {/* Hour marks */}
                {miniHourMarks.map((ms) => {
                  const x = msToMiniX(ms);
                  return (
                    <g key={`mini-hm-${ms}`}>
                      <line
                        x1={x}
                        x2={x}
                        y1={MINI_HEADER_HEIGHT}
                        y2={miniTotalHeight}
                        stroke="var(--af-border-subtle)"
                        strokeWidth={0.5}
                        strokeDasharray="2 3"
                      />
                      <text
                        x={x}
                        y={MINI_HEADER_HEIGHT - 6}
                        textAnchor="middle"
                        fontSize={9}
                        fill="var(--af-text-tertiary)"
                      >
                        {fmtTime(ms)}
                      </text>
                    </g>
                  );
                })}

                {/* Session rows — clickable via an invisible row hit rect */}
                {involved.map((s, i) => {
                  const y = MINI_HEADER_HEIGHT + i * (MINI_ROW_HEIGHT + MINI_ROW_GAP);
                  const color = sessionColor(s);
                  const isFocused = focusedSessionId === s.id;
                  return (
                    <g key={`mini-row-${s.id}`}>
                      {/* Row hit target — click the whole row to focus */}
                      <rect
                        x={0}
                        y={y}
                        width={MINI_CHART_WIDTH}
                        height={MINI_ROW_HEIGHT}
                        fill={
                          isFocused
                            ? "rgba(255,255,255,0.05)"
                            : "transparent"
                        }
                        onClick={() => handleFocusTrack(s.id)}
                        style={{ cursor: "pointer" }}
                      />
                      {s.segments.map((seg, si) => {
                        const x1 = msToMiniX(seg.startMs);
                        const x2 = msToMiniX(seg.endMs);
                        const w = Math.max(x2 - x1, 2);
                        return (
                          <rect
                            key={`mini-seg-${si}`}
                            x={x1}
                            y={y + 3}
                            width={w}
                            height={MINI_ROW_HEIGHT - 6}
                            fill={color}
                            rx={2}
                            stroke={isFocused ? "var(--af-text)" : "none"}
                            strokeWidth={isFocused ? 1 : 0}
                            style={{ pointerEvents: "none" }}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Session cards */}
          <div
            style={{
              fontSize: 10,
              color: "var(--af-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: "18px 0 8px",
              fontWeight: 600,
            }}
          >
            Sessions in this burst
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {involved.map((s, i) => {
              const color = sessionColor(s);
              const activeMs = activeInBurst(s);
              const activePct = totalDurationMs > 0
                ? Math.round((activeMs / totalDurationMs) * 100)
                : 0;
              const isFocused = focusedSessionId === s.id;
              return (
                <Link
                  key={`burst-session-${s.id}`}
                  href={`/sessions/${s.id}`}
                  ref={(el) => {
                    if (el) cardRefs.current.set(s.id, el);
                    else cardRefs.current.delete(s.id);
                  }}
                  style={{
                    display: "block",
                    padding: "11px 14px",
                    background: isFocused
                      ? "var(--af-surface-hover)"
                      : "var(--af-surface)",
                    border: isFocused
                      ? "1px solid var(--af-text-tertiary)"
                      : "1px solid var(--af-border-subtle)",
                    borderLeft: `3px solid ${color}`,
                    borderRadius: 8,
                    textDecoration: "none",
                    color: "var(--af-text)",
                    fontSize: 12,
                    lineHeight: 1.45,
                    transition: "background 0.15s, border-color 0.15s",
                    boxShadow: isFocused
                      ? `0 0 0 2px ${color}`
                      : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    {/* Numbered track badge matching the mini-Gantt row */}
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: isFocused ? color : "transparent",
                        border: `1.5px solid ${color}`,
                        color: isFocused ? "#fff" : "var(--af-text)",
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                      aria-label={`Track ${i + 1}`}
                    >
                      {i + 1}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--af-text-tertiary)",
                          fontFamily: "var(--font-mono)",
                          marginBottom: 3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={prettyProjectName(s.projectName)}
                      >
                        {(() => {
                          const name = prettyProjectName(s.projectName);
                          const parts = name.split("/").filter(Boolean);
                          return parts.length > 2
                            ? "…/" + parts.slice(-2).join("/")
                            : name;
                        })()}
                      </div>
                      <div
                        style={{
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={stripXml(s.firstUserPreview ?? "")}
                      >
                        {stripXml(s.firstUserPreview ?? "") || (
                          <em style={{ color: "var(--af-text-tertiary)" }}>
                            (no user message)
                          </em>
                        )}
                      </div>
                      {s.lastAgentPreview && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--af-text-secondary)",
                            marginTop: 3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontStyle: "italic",
                          }}
                          title={stripXml(s.lastAgentPreview)}
                        >
                          ↳ {stripXml(s.lastAgentPreview)}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--af-text-tertiary)",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 4,
                      }}
                    >
                      {(() => {
                        const sum = sessionEntries[s.id];
                        if (sum?.outcome) {
                          return <OutcomePill outcome={sum.outcome} size="sm" label="text" agent={s.agent} />;
                        }
                        return null;
                      })()}
                      <div style={{ color: "var(--af-text-secondary)" }}>
                        {formatDuration(activeMs)}{" "}
                        <span style={{ opacity: 0.6 }}>({activePct}%)</span>
                      </div>
                      <div style={{ fontSize: 9, marginTop: 2 }}>
                        in burst
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
