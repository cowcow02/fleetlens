"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  canonicalProjectName,
  type GanttDay,
  type GanttSession,
  type ParallelismBurst,
} from "@claude-lens/parser";
import type { DayOutcome, EntryEnrichmentStatus } from "@claude-lens/entries";
import { formatDuration, formatTokens, prettyProjectName } from "@/lib/format";
import { OutcomePill } from "@/components/outcome-pill";
import { AgentIcon } from "@/components/agent-icon";
import {
  BURST_RIBBON_HEIGHT,
  HEADER_HEIGHT,
  LABEL_WIDTH,
  MIN_CHART_WIDTH,
  PAD_MS,
  ROW_GAP,
  ROW_HEIGHT,
  fmtTime,
  projectColor,
  sessionColor,
  stripXml,
} from "./gantt-chart-utils";
import { ConcurrencyInfoModal } from "./concurrency-info-modal";
import { BurstDetailModal } from "./burst-detail-modal";

export type SessionEntrySummary = {
  outcome: DayOutcome | null;
  briefSummary: string | null;
  enrichmentStatus: EntryEnrichmentStatus;
  localDay: string;
};

export function GanttChart({
  gantt,
  bursts = [],
  sessionEntries = {},
}: {
  gantt: GanttDay;
  bursts?: ParallelismBurst[];
  sessionEntries?: Record<string, SessionEntrySummary>;
}) {
  // The gantt is scoped to one local day; carry that day on session links so a
  // multi-day session opens pinned to THIS day instead of its most-recent one.
  // gantt.date is already that zero-padded `YYYY-MM-DD` local-day key (the same
  // one the session view buckets on), so use it directly rather than round-
  // tripping dayStartMs back through a timezone-sensitive Date.
  const dayParam = gantt.date;

  const [hover, setHover] = useState<{
    session: GanttSession;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredBurstIdx, setHoveredBurstIdx] = useState<number | null>(null);
  const [pinnedBurstIdx, setPinnedBurstIdx] = useState<number | null>(null);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  // When non-null, a burst detail modal is open for this burst index.
  const [detailBurstIdx, setDetailBurstIdx] = useState<number | null>(null);
  // Whether to show all bursts in the Concurrency list or only the first
  // few (most recent). Busy days have many bursts; showing all by default
  // makes the panel dominate the scroll.
  const [showAllBursts, setShowAllBursts] = useState(false);
  const INITIAL_BURST_COUNT = 3;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Active burst = pinned (if set) else hovered.
  const activeBurstIdx = pinnedBurstIdx ?? hoveredBurstIdx;

  // Session IDs that belong to the active burst — used to dim non-matching
  // rows in the Gantt below so the user can tell "which sessions were
  // actually parallel during this burst".
  const highlightedSessionIds = useMemo(() => {
    if (activeBurstIdx === null) return null;
    const burst = bursts[activeBurstIdx];
    if (!burst) return null;
    return new Set(burst.sessionIds);
  }, [activeBurstIdx, bursts]);

  const projectLegend = useMemo(() => {
    const seen = new Map<string, { name: string; color: string; count: number }>();
    for (const s of gantt.sessions) {
      // Group the legend by canonical project name so all worktrees of a
      // repo collapse into one legend entry with a shared color.
      const canonical = canonicalProjectName(s.projectName);
      const existing = seen.get(canonical);
      if (existing) {
        existing.count++;
      } else {
        seen.set(canonical, {
          name: prettyProjectName(canonical),
          color: projectColor(canonical),
          count: 1,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [gantt.sessions]);

  const { rangeStartMs, rangeEndMs, hourMarks } = useMemo(() => {
    if (gantt.sessions.length === 0) {
      return {
        rangeStartMs: gantt.dayStartMs,
        rangeEndMs: gantt.dayEndMs,
        hourMarks: [] as number[],
      };
    }
    let earliest = Infinity;
    let latest = -Infinity;
    for (const s of gantt.sessions) {
      for (const seg of s.segments) {
        if (seg.startMs < earliest) earliest = seg.startMs;
        if (seg.endMs > latest) latest = seg.endMs;
      }
    }
    const padded0 = earliest - PAD_MS;
    const padded1 = latest + PAD_MS;
    const startHour = new Date(padded0);
    startHour.setMinutes(0, 0, 0);
    const endHour = new Date(padded1);
    endHour.setMinutes(0, 0, 0);
    endHour.setHours(endHour.getHours() + 1);

    const rangeStartMs = Math.max(startHour.getTime(), gantt.dayStartMs);
    const rangeEndMs = Math.min(endHour.getTime(), gantt.dayEndMs);

    const marks: number[] = [];
    const cur = new Date(rangeStartMs);
    cur.setMinutes(0, 0, 0);
    if (cur.getTime() < rangeStartMs) cur.setHours(cur.getHours() + 1);
    while (cur.getTime() <= rangeEndMs) {
      marks.push(cur.getTime());
      cur.setHours(cur.getHours() + 1);
    }

    return { rangeStartMs, rangeEndMs, hourMarks: marks };
  }, [gantt]);

  const rangeDuration = rangeEndMs - rangeStartMs;
  const chartWidth = Math.max(
    MIN_CHART_WIDTH,
    Math.ceil((rangeDuration / (60 * 60 * 1000)) * 80),
  );
  const bodyHeight = gantt.sessions.length * (ROW_HEIGHT + ROW_GAP) + ROW_GAP + 8;

  // Map ms → x within the chart body (NOT including the label column offset)
  const msToX = (ms: number): number => {
    const frac = (ms - rangeStartMs) / rangeDuration;
    return frac * chartWidth;
  };

  const stickyBg = "var(--af-surface)";

  const handlePinBurst = (i: number) => {
    setPinnedBurstIdx((cur) => (cur === i ? null : i));
    const burst = bursts[i];
    const el = scrollContainerRef.current;
    if (!burst || !el) return;
    const burstCenter =
      LABEL_WIDTH + (msToX(burst.startMs) + msToX(burst.endMs)) / 2;
    const targetScroll = burstCenter - el.clientWidth / 2;
    el.scrollTo({
      left: Math.max(0, targetScroll),
      behavior: "smooth",
    });
  };

  const visibleBursts = showAllBursts
    ? bursts
    : bursts.slice(0, INITIAL_BURST_COUNT);
  const hiddenBurstCount = bursts.length - visibleBursts.length;

  return (
    <>
      {bursts.length > 0 && (
        <div className="af-panel" style={{ marginBottom: 16 }}>
          <div className="af-panel-header">
            <span>Concurrency</span>
            <span
              style={{
                fontSize: 11,
                color: "var(--af-text-tertiary)",
                fontWeight: 400,
              }}
            >
              periods when ≥2 agents were actively working at once
            </span>
            <button
              type="button"
              onClick={() => setInfoModalOpen(true)}
              aria-label="How concurrency is detected"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                background: "transparent",
                border: "1px solid var(--af-border-subtle)",
                borderRadius: 100,
                fontSize: 10,
                color: "var(--af-text-tertiary)",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              <span style={{ fontSize: 11, lineHeight: 1 }}>ⓘ</span>
              How this is measured
            </button>
          </div>
          <div>
            {visibleBursts.map((burst, i) => {
              const isPinned = pinnedBurstIdx === i;
              const isHovered = hoveredBurstIdx === i;
              const projectNames = burst.projectDirs
                .map((dir) => {
                  const session = gantt.sessions.find((s) => s.projectDir === dir);
                  return session ? prettyProjectName(session.projectName) : dir;
                })
                .map((name) => {
                  const parts = name.split("/").filter(Boolean);
                  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : name;
                });
              return (
                <div
                  key={`burst-row-${i}`}
                  onMouseEnter={() => setHoveredBurstIdx(i)}
                  onMouseLeave={() => setHoveredBurstIdx(null)}
                  onClick={() => setDetailBurstIdx(i)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto auto 1fr auto",
                    gap: 14,
                    padding: "10px 18px",
                    fontSize: 12,
                    borderBottom: "1px solid var(--af-border-subtle)",
                    cursor: "pointer",
                    background: isPinned
                      ? "var(--af-surface-hover)"
                      : isHovered
                        ? "var(--af-surface-hover)"
                        : "transparent",
                    alignItems: "center",
                    transition: "background 0.12s",
                  }}
                  title="Open burst detail"
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--af-text-secondary)",
                      minWidth: 110,
                    }}
                  >
                    {fmtTime(burst.startMs)}–{fmtTime(burst.endMs)}
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      borderRadius: 10,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "white",
                      background: burst.crossProject
                        ? "rgba(167, 139, 250, 0.9)"
                        : "rgba(45, 212, 191, 0.9)",
                      minWidth: 28,
                      justifyContent: "center",
                    }}
                  >
                    ×{burst.peak}
                  </span>
                  {burst.crossProject ? (
                    <span
                      style={{
                        fontSize: 9,
                        color: "rgba(167, 139, 250, 1)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        fontWeight: 600,
                      }}
                    >
                      cross-project
                    </span>
                  ) : (
                    <span />
                  )}
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--af-text-tertiary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={projectNames.join(", ")}
                  >
                    {projectNames.join(" · ")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--af-text-secondary)",
                      minWidth: 60,
                      textAlign: "right",
                    }}
                  >
                    {formatDuration(burst.endMs - burst.startMs)}
                  </span>
                </div>
              );
            })}

            {/* Expand / collapse toggle */}
            {bursts.length > INITIAL_BURST_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllBursts((v) => !v)}
                style={{
                  width: "100%",
                  padding: "10px 18px",
                  background: "transparent",
                  border: "none",
                  borderTop: "1px solid var(--af-border-subtle)",
                  fontSize: 11,
                  color: "var(--af-text-secondary)",
                  cursor: "pointer",
                  fontWeight: 500,
                  textAlign: "center",
                }}
              >
                {showAllBursts
                  ? `Show fewer (first ${INITIAL_BURST_COUNT}) ↑`
                  : `Show all ${bursts.length} bursts (+${hiddenBurstCount} more) ↓`}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="af-panel" style={{ overflow: "hidden" }}>
      {/* Legend — stays above the scroll area */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 16px",
          borderBottom: "1px solid var(--af-border-subtle)",
          fontSize: 11,
          color: "var(--af-text-secondary)",
          flexWrap: "wrap",
        }}
      >
        {projectLegend.map((p) => {
          const parts = p.name.split("/").filter(Boolean);
          const short =
            parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p.name;
          return (
            <span
              key={p.name}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "default" }}
              title={`${p.name} — ${p.count} session${p.count === 1 ? "" : "s"} on this day`}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: p.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {short}
              </span>
              <span style={{ color: "var(--af-text-tertiary)", fontSize: 10 }}>({p.count})</span>
            </span>
          );
        })}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginLeft: 8,
            color: "var(--af-text-tertiary)",
            cursor: "default",
          }}
          title="Idle gap — the session was open but the agent was not actively working (gap > 3 minutes between events)"
        >
          <span
            style={{
              width: 16,
              height: 8,
              borderRadius: 2,
              background:
                "repeating-linear-gradient(45deg, var(--af-surface-hover), var(--af-surface-hover) 2px, var(--af-border-subtle) 2px, var(--af-border-subtle) 4px)",
              flexShrink: 0,
            }}
          />
          idle
        </span>
      </div>

      {/* Scroll container — handles both axes. Sticky elements inside reference this. */}
      <div
        ref={scrollContainerRef}
        style={{
          overflow: "auto",
          maxHeight: "calc(100vh - 240px)",
          position: "relative",
        }}
        onMouseLeave={() => setHover(null)}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${LABEL_WIDTH}px ${chartWidth}px`,
            gridTemplateRows: `${BURST_RIBBON_HEIGHT + HEADER_HEIGHT}px ${bodyHeight}px`,
            width: LABEL_WIDTH + chartWidth,
          }}
        >
          {/* (0,0) top-left corner — sticky to both edges.
              Stacks: burst-row label (top) above an empty hour-row spacer. */}
          <div
            style={{
              position: "sticky",
              top: 0,
              left: 0,
              zIndex: 3,
              background: stickyBg,
              borderBottom: "1px solid var(--af-border-subtle)",
              borderRight: "1px solid var(--af-border-subtle)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                height: BURST_RIBBON_HEIGHT,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                padding: "0 10px",
                fontSize: 9,
                color: "var(--af-text-tertiary)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {bursts.length > 0 ? "Concurrency" : ""}
            </div>
            <div style={{ height: HEADER_HEIGHT }} />
          </div>

          {/* (0,1) header cell — burst ribbon stacked above hour labels, sticky top */}
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              background: stickyBg,
              borderBottom: "1px solid var(--af-border-subtle)",
            }}
          >
            {/* Burst ribbon */}
            <svg
              width={chartWidth}
              height={BURST_RIBBON_HEIGHT}
              style={{ display: "block" }}
            >
              {bursts.map((burst, i) => {
                const xStart = msToX(burst.startMs);
                const xEnd = msToX(burst.endMs);
                const realW = xEnd - xStart;
                // Min visual width so the ×N label always fits.
                const MIN_W = 26;
                const w = Math.max(realW, MIN_W);
                // Center the pill on the real midpoint when inflated.
                const x1 = realW < MIN_W ? xStart + realW / 2 - MIN_W / 2 : xStart;
                const isActive = activeBurstIdx === i;
                const isDimmed = activeBurstIdx !== null && !isActive;
                const fill = burst.crossProject
                  ? "rgba(167, 139, 250, 0.9)" // purple
                  : "rgba(45, 212, 191, 0.9)"; // teal
                return (
                  <g key={`burst-${i}`}>
                    <rect
                      x={x1}
                      y={4}
                      width={w}
                      height={BURST_RIBBON_HEIGHT - 10}
                      fill={fill}
                      rx={4}
                      opacity={isDimmed ? 0.3 : 1}
                      stroke={
                        pinnedBurstIdx === i
                          ? "var(--af-text)"
                          : hoveredBurstIdx === i
                            ? "var(--af-text-secondary)"
                            : "none"
                      }
                      strokeWidth={pinnedBurstIdx === i ? 1.5 : 1}
                      style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                      onMouseEnter={() => setHoveredBurstIdx(i)}
                      onMouseLeave={() => setHoveredBurstIdx(null)}
                      onClick={() => setDetailBurstIdx(i)}
                    >
                      <title>
                        {`×${burst.peak} ${burst.crossProject ? "cross-project" : "same-project"} · ${fmtTime(burst.startMs)}–${fmtTime(burst.endMs)} · ${formatDuration(burst.endMs - burst.startMs)} — click for detail`}
                      </title>
                    </rect>
                    <text
                      x={x1 + w / 2}
                      y={BURST_RIBBON_HEIGHT / 2 + 3}
                      textAnchor="middle"
                      fontSize={9}
                      fontWeight={700}
                      fill="white"
                      opacity={isDimmed ? 0.3 : 1}
                      style={{ pointerEvents: "none" }}
                    >
                      ×{burst.peak}
                    </text>
                  </g>
                );
              })}
            </svg>

            <svg
              width={chartWidth}
              height={HEADER_HEIGHT}
              style={{ display: "block" }}
            >
              {hourMarks.map((ms) => {
                const x = msToX(ms);
                const d = new Date(ms);
                const isMainHour = d.getHours() % 3 === 0;
                return (
                  <text
                    key={ms}
                    x={x}
                    y={HEADER_HEIGHT - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill={
                      isMainHour ? "var(--af-text-secondary)" : "var(--af-text-tertiary)"
                    }
                    fontWeight={isMainHour ? 600 : 400}
                  >
                    {fmtTime(ms)}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* (1,0) session labels column — sticky left */}
          <div
            style={{
              position: "sticky",
              left: 0,
              zIndex: 1,
              background: stickyBg,
              borderRight: "1px solid var(--af-border-subtle)",
            }}
          >
            <div style={{ paddingTop: ROW_GAP }}>
              {gantt.sessions.map((session, i) => {
                const color = sessionColor(session);
                const label = session.firstUserPreview
                  ? stripXml(session.firstUserPreview).slice(0, 45)
                  : prettyProjectName(session.projectName);
                const projectLabel = prettyProjectName(session.projectName);
                const dimmed =
                  highlightedSessionIds !== null &&
                  !highlightedSessionIds.has(session.id);
                return (
                  <div
                    key={`label-${session.id}-${i}`}
                    style={{
                      height: ROW_HEIGHT,
                      marginBottom: ROW_GAP,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "0 8px 0 6px",
                      background:
                        i % 2 === 1 ? "var(--af-surface-hover)" : "transparent",
                      opacity: dimmed ? 0.3 : 1,
                      transition: "opacity 0.12s",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 2,
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <AgentIcon agent={session.agent} size={11} />

                    <Link
                      href={`/sessions/${session.id}?day=${dayParam}`}
                      style={{
                        fontSize: 10.5,
                        color: "var(--af-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: 1.2,
                        textDecoration: "none",
                      }}
                      title={`${stripXml(session.firstUserPreview ?? "")} — ${projectLabel}`}
                    >
                      {label}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          {/* (1,1) main chart body — bars + grid + idle + right-end text */}
          <div>
            <svg width={chartWidth} height={bodyHeight} style={{ display: "block" }}>
              <defs>
                <pattern
                  id="gantt-idle-stripes"
                  patternUnits="userSpaceOnUse"
                  width="6"
                  height="6"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill="var(--af-surface-hover)" />
                  <line
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="6"
                    stroke="var(--af-border-subtle)"
                    strokeWidth="1.5"
                  />
                </pattern>
              </defs>

              {/* Hour grid lines */}
              {hourMarks.map((ms) => {
                const x = msToX(ms);
                const d = new Date(ms);
                const isMainHour = d.getHours() % 3 === 0;
                return (
                  <line
                    key={ms}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={bodyHeight}
                    stroke="var(--af-border-subtle)"
                    strokeWidth={isMainHour ? 0.8 : 0.4}
                    strokeDasharray={isMainHour ? undefined : "2 4"}
                  />
                );
              })}

              {/* Session rows */}
              {gantt.sessions.map((session, i) => {
                const y = i * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
                const color = sessionColor(session);
                const dimmed =
                  highlightedSessionIds !== null &&
                  !highlightedSessionIds.has(session.id);

                return (
                  <g
                    key={`row-${session.id}-${i}`}
                    opacity={dimmed ? 0.25 : 1}
                    style={{ transition: "opacity 0.12s" }}
                  >
                    {i % 2 === 1 && (
                      <rect
                        x={0}
                        y={y}
                        width={chartWidth}
                        height={ROW_HEIGHT}
                        fill="var(--af-surface-hover)"
                        opacity={0.25}
                      />
                    )}

                    {/* Active segments */}
                    {session.segments.map((seg, si) => {
                      const x1 = msToX(seg.startMs);
                      const x2 = msToX(seg.endMs);
                      const w = Math.max(x2 - x1, 4);
                      return (
                        <rect
                          key={si}
                          x={x1}
                          y={y + 5}
                          width={w}
                          height={ROW_HEIGHT - 10}
                          fill={color}
                          rx={3}
                          style={{ cursor: "pointer" }}
                          onMouseEnter={(e) => {
                            const svgRect = (
                              e.currentTarget.closest("svg") as SVGElement
                            ).getBoundingClientRect();
                            setHover({
                              session,
                              x: e.clientX - svgRect.left + LABEL_WIDTH,
                              y: y + ROW_HEIGHT + BURST_RIBBON_HEIGHT + HEADER_HEIGHT + 4,
                            });
                          }}
                        />
                      );
                    })}

                    {/* Idle gaps */}
                    {session.segments.length > 1 &&
                      session.segments.slice(0, -1).map((seg, si) => {
                        const next = session.segments[si + 1]!;
                        const x1 = msToX(seg.endMs);
                        const x2 = msToX(next.startMs);
                        if (x2 - x1 < 4) return null;
                        return (
                          <rect
                            key={`idle-${si}`}
                            x={x1 + 1}
                            y={y + 7}
                            width={x2 - x1 - 2}
                            height={ROW_HEIGHT - 14}
                            fill="url(#gantt-idle-stripes)"
                            rx={2}
                            opacity={0.7}
                          />
                        );
                      })}

                    {/* Active time + time range at right end */}
                    <text
                      x={Math.min(msToX(session.endMs) + 8, chartWidth - 100)}
                      y={y + ROW_HEIGHT / 2 + 3.5}
                      fontSize={9}
                      fill="var(--af-text-tertiary)"
                      fontFamily="var(--font-mono)"
                    >
                      {formatDuration(session.activeMs)}
                      {" · "}
                      {fmtTime(session.startMs)}–{fmtTime(session.endMs)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Hover tooltip */}
        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.max(8, Math.min(hover.x, LABEL_WIDTH + chartWidth - 340)),
              top: Math.min(hover.y, BURST_RIBBON_HEIGHT + HEADER_HEIGHT + bodyHeight - 100),
              zIndex: 50,
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 11,
              color: "var(--af-text)",
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxWidth: 340,
              lineHeight: 1.45,
            }}
          >
            {(() => {
              const sum = sessionEntries[hover.session.id];
              if (!sum) return null;
              if (sum.outcome) {
                return (
                  <div style={{ marginBottom: 6 }}>
                    <OutcomePill outcome={sum.outcome} size="sm" agent={hover.session.agent} />
                  </div>
                );
              }
              if (sum.enrichmentStatus !== "done" && sum.enrichmentStatus !== "skipped_trivial") {
                return (
                  <div style={{ marginBottom: 6 }}>
                    <OutcomePill
                      outcome={null}
                      pending
                      sessionId={hover.session.id}
                      localDay={sum.localDay}
                      size="sm"
                      agent={hover.session.agent}
                    />
                  </div>
                );
              }
              return null;
            })()}
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {sessionEntries[hover.session.id]?.briefSummary ||
                stripXml(hover.session.firstUserPreview ?? "").slice(0, 100) ||
                prettyProjectName(hover.session.projectName)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--af-text-secondary)",
                marginBottom: 6,
                fontFamily: "var(--font-mono)",
              }}
            >
              {prettyProjectName(hover.session.projectName)}
              {hover.session.model && ` · ${hover.session.model}`}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "3px 12px",
                fontSize: 10,
                color: "var(--af-text-secondary)",
              }}
            >
              <span>
                Active: <strong>{formatDuration(hover.session.activeMs)}</strong>
              </span>
              <span>Segments: {hover.session.segments.length}</span>
              <span>
                Range: {fmtTime(hover.session.startMs)}–{fmtTime(hover.session.endMs)}
              </span>
              <span>
                Tokens:{" "}
                {formatTokens(
                  hover.session.totalUsage.input +
                    hover.session.totalUsage.cacheRead +
                    hover.session.totalUsage.cacheWrite,
                )}
                /{formatTokens(hover.session.totalUsage.output)}
              </span>
            </div>
          </div>
        )}
      </div>
      </div>

      {infoModalOpen && (
        <ConcurrencyInfoModal onClose={() => setInfoModalOpen(false)} />
      )}

      {detailBurstIdx !== null && bursts[detailBurstIdx] && (
        <BurstDetailModal
          burst={bursts[detailBurstIdx]!}
          gantt={gantt}
          sessionEntries={sessionEntries}
          onClose={() => setDetailBurstIdx(null)}
          onShowInTimeline={() => {
            const idx = detailBurstIdx;
            setDetailBurstIdx(null);
            if (idx !== null) {
              // Pin + scroll; reuse the existing handler.
              handlePinBurst(idx);
            }
          }}
        />
      )}
    </>
  );
}
