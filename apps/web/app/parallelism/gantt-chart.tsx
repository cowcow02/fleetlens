"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalProjectName,
  type GanttDay,
  type GanttSession,
  type ParallelismBurst,
} from "@claude-lens/parser";
import { formatDuration, formatTokens, prettyProjectName } from "@/lib/format";

const ROW_HEIGHT = 30;
const ROW_GAP = 3;
const LABEL_WIDTH = 220;
const HEADER_HEIGHT = 26;
const BURST_RIBBON_HEIGHT = 24;
const MIN_CHART_WIDTH = 700;
const PAD_MS = 30 * 60 * 1000; // 30-min padding on each side

const PROJECT_COLORS = [
  "rgba(45, 212, 191, 0.75)",
  "rgba(167, 139, 250, 0.75)",
  "rgba(248, 113, 113, 0.75)",
  "rgba(52, 211, 153, 0.75)",
  "rgba(251, 191, 36, 0.75)",
  "rgba(236, 72, 153, 0.75)",
  "rgba(34, 211, 238, 0.75)",
  "rgba(168, 85, 247, 0.75)",
  "rgba(244, 114, 82, 0.75)",
  "rgba(96, 165, 250, 0.75)",
];

/**
 * Hash a project key to a stable color. The key should be a canonical
 * project identity (not a raw projectDir) so all worktrees of the same
 * repo share one color — visually grouping "this repo's parallel work".
 */
function projectColor(projectKey: string): string {
  let hash = 0;
  for (let i = 0; i < projectKey.length; i++) {
    hash = ((hash << 5) - hash + projectKey.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!;
}

/** Color for a Gantt session, keyed by canonical project name. */
function sessionColor(s: { projectName: string }): string {
  return projectColor(canonicalProjectName(s.projectName));
}

function stripXml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function GanttChart({
  gantt,
  bursts = [],
}: {
  gantt: GanttDay;
  bursts?: ParallelismBurst[];
}) {
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
                    <Link
                      href={`/sessions/${session.id}`}
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
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {stripXml(hover.session.firstUserPreview ?? "").slice(0, 100) ||
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

function ConcurrencyInfoModal({ onClose }: { onClose: () => void }) {
  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="concurrency-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0, 0, 0, 0.5)",
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
          maxWidth: 560,
          width: "100%",
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 22px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <h2
            id="concurrency-modal-title"
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            How concurrency is measured
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text-tertiary)",
              fontSize: 22,
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

        <div
          style={{
            padding: "18px 22px",
            fontSize: 13,
            color: "var(--af-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          <p style={{ margin: "0 0 14px" }}>
            A <strong style={{ color: "var(--af-text)" }}>concurrency burst</strong>{" "}
            is a window of time when two or more Claude Code sessions were
            actively working in parallel. The goal is to surface moments
            when you were running a multi-agent fleet — not every accidental
            tab overlap.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            1. What counts as &quot;active&quot;
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            Each session&apos;s events are split into{" "}
            <strong style={{ color: "var(--af-text)" }}>active segments</strong> —
            stretches of time where no gap between consecutive events exceeds{" "}
            <strong style={{ color: "var(--af-text)" }}>3 minutes</strong>. Any longer
            gap (walked away, laptop closed, thinking) splits the session
            into separate segments.
          </p>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--af-text-tertiary)" }}>
            This is the same definition used for the &quot;active time&quot; metric on
            the dashboard, so numbers stay consistent.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            2. Detecting overlap
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            A sweep-line walks every segment start/end across all sessions.
            Whenever the active count is ≥2, that stretch becomes a raw
            overlap. The <strong style={{ color: "var(--af-text)" }}>peak</strong>{" "}
            reported on each burst is the maximum active count reached
            anywhere inside it.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            3. Cleaning up noise
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            Raw overlaps are noisy — a typical day produces dozens of
            sub-minute artifacts from switching between sessions. Two rules
            collapse them into human-readable bursts:
          </p>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 22 }}>
            <li style={{ marginBottom: 4 }}>
              <strong style={{ color: "var(--af-text)" }}>Drop under 1 minute</strong> —
              overlaps shorter than that are almost always tab-switch
              artifacts, not real parallel work.
            </li>
            <li>
              <strong style={{ color: "var(--af-text)" }}>Merge within 10 minutes</strong> —
              two overlaps separated by less than 10 minutes of idle time
              fuse into a single burst. A morning of back-and-forth agent
              work becomes one burst, not forty.
            </li>
          </ul>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            4. Same-project vs cross-project
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            Bursts are colored by whether the involved sessions span more
            than one project directory.{" "}
            <span style={{ color: "rgba(167, 139, 250, 1)", fontWeight: 600 }}>
              Purple = cross-project
            </span>{" "}
            — different repos running at once, usually genuine fleet work.{" "}
            <span style={{ color: "rgba(45, 212, 191, 1)", fontWeight: 600 }}>
              Teal = same-project
            </span>{" "}
            — multiple sessions in one repo, usually context-switching
            inside a single task.
          </p>

          <h3
            style={{
              margin: "18px 0 8px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--af-text)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Why bursts, not runs
          </h3>
          <p style={{ margin: "0 0 6px" }}>
            An earlier version reported every raw overlap as a separate
            &quot;parallel run&quot;. On a busy day that produced 40–80 entries,
            most of them seconds long, most of them meaningless. Bursts are
            the unit humans actually think in: &quot;this morning I was
            running 3 agents at once for about 20 minutes.&quot;
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Burst detail modal                                                */
/* ================================================================== */

function BurstDetailModal({
  burst,
  gantt,
  onClose,
  onShowInTimeline,
}: {
  burst: ParallelismBurst;
  gantt: GanttDay;
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
                      }}
                    >
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
