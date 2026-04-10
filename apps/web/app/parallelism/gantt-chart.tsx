"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { GanttDay, GanttSession } from "@claude-lens/parser";
import { formatDuration, formatTokens, prettyProjectName } from "@/lib/format";

const ROW_HEIGHT = 30;
const ROW_GAP = 3;
const LABEL_WIDTH = 220;
const HEADER_HEIGHT = 26;
const MIN_CHART_WIDTH = 700;
const PAD_MS = 30 * 60 * 1000; // 30-min padding on each side

// Per-project color palette — hash project name to pick a consistent color.
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

function projectColor(projectDir: string): string {
  let hash = 0;
  for (let i = 0; i < projectDir.length; i++) {
    hash = ((hash << 5) - hash + projectDir.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!;
}

/** Strip XML tags from a preview string (teammate-message, local-command-caveat, etc.) */
function stripXml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Format an absolute ms timestamp as "HH:MM" in local time. */
function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function GanttChart({ gantt }: { gantt: GanttDay }) {
  const [hover, setHover] = useState<{
    session: GanttSession;
    x: number;
    y: number;
  } | null>(null);

  // Build project legend: unique projects, each with their color.
  const projectLegend = useMemo(() => {
    const seen = new Map<string, { name: string; color: string; count: number }>();
    for (const s of gantt.sessions) {
      const existing = seen.get(s.projectDir);
      if (existing) {
        existing.count++;
      } else {
        seen.set(s.projectDir, {
          name: prettyProjectName(s.projectName),
          color: projectColor(s.projectDir),
          count: 1,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [gantt.sessions]);

  // Auto-zoom: compute the visible time range from actual segment bounds
  // instead of always showing midnight-to-midnight.
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
    // Pad and snap to hour boundaries for clean grid lines.
    const padded0 = earliest - PAD_MS;
    const padded1 = latest + PAD_MS;
    const startHour = new Date(padded0);
    startHour.setMinutes(0, 0, 0);
    const endHour = new Date(padded1);
    endHour.setMinutes(0, 0, 0);
    endHour.setHours(endHour.getHours() + 1);

    const rangeStartMs = Math.max(startHour.getTime(), gantt.dayStartMs);
    const rangeEndMs = Math.min(endHour.getTime(), gantt.dayEndMs);

    // Build hour marks within the visible range.
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
    Math.ceil((rangeDuration / (60 * 60 * 1000)) * 80), // ~80px per hour
  );
  const totalWidth = LABEL_WIDTH + chartWidth;
  const totalHeight =
    HEADER_HEIGHT + gantt.sessions.length * (ROW_HEIGHT + ROW_GAP) + ROW_GAP + 8;

  const msToX = (ms: number): number => {
    const frac = (ms - rangeStartMs) / rangeDuration;
    return LABEL_WIDTH + frac * chartWidth;
  };

  return (
    <div
      className="af-panel"
      style={{ overflow: "auto", position: "relative" }}
    >
      {/* Legend */}
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
          // Shorten long paths: keep last 2 segments max.
          const parts = p.name.split("/").filter(Boolean);
          const short =
            parts.length > 2
              ? "…/" + parts.slice(-2).join("/")
              : p.name;
          return (
            <span
              key={p.name}
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              title={p.name}
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
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {short}
              </span>
              <span style={{ color: "var(--af-text-tertiary)", fontSize: 10 }}>
                ({p.count})
              </span>
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
          }}
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

      <div style={{ minWidth: totalWidth }}>
        <svg
          width={totalWidth}
          height={totalHeight}
          style={{ display: "block" }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Stripe pattern for idle gaps */}
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
                x1="0" y1="0" x2="0" y2="6"
                stroke="var(--af-border-subtle)"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>

          {/* Hour grid lines + labels */}
          {hourMarks.map((ms) => {
            const x = msToX(ms);
            const d = new Date(ms);
            const isMainHour = d.getHours() % 3 === 0;
            return (
              <g key={ms}>
                <line
                  x1={x}
                  y1={HEADER_HEIGHT}
                  x2={x}
                  y2={totalHeight}
                  stroke="var(--af-border-subtle)"
                  strokeWidth={isMainHour ? 0.8 : 0.4}
                  strokeDasharray={isMainHour ? undefined : "2 4"}
                />
                <text
                  x={x}
                  y={HEADER_HEIGHT - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill={
                    isMainHour
                      ? "var(--af-text-secondary)"
                      : "var(--af-text-tertiary)"
                  }
                  fontWeight={isMainHour ? 600 : 400}
                >
                  {fmtTime(ms)}
                </text>
              </g>
            );
          })}

          {/* Session rows */}
          {gantt.sessions.map((session, i) => {
            const y = HEADER_HEIGHT + i * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
            const color = projectColor(session.projectDir);
            const label = session.firstUserPreview
              ? stripXml(session.firstUserPreview).slice(0, 45)
              : prettyProjectName(session.projectName);
            const projectLabel = prettyProjectName(session.projectName);

            return (
              <g key={`${session.id}-${i}`}>
                {/* Subtle row stripe */}
                {i % 2 === 1 && (
                  <rect
                    x={0}
                    y={y}
                    width={totalWidth}
                    height={ROW_HEIGHT}
                    fill="var(--af-surface-hover)"
                    opacity={0.25}
                  />
                )}

                {/* Session label */}
                <foreignObject x={4} y={y} width={LABEL_WIDTH - 8} height={ROW_HEIGHT}>
                  <div
                    style={{
                      height: ROW_HEIGHT,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
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
                      }}
                      title={`${stripXml(session.firstUserPreview ?? "")} — ${projectLabel}`}
                    >
                      {label}
                    </Link>
                  </div>
                </foreignObject>

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
                          x: e.clientX - svgRect.left,
                          y: y + ROW_HEIGHT + 4,
                        });
                      }}
                    />
                  );
                })}

                {/* Idle gaps (zebra-striped rectangles) */}
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
                  x={Math.min(msToX(session.endMs) + 8, totalWidth - 100)}
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

        {/* Hover tooltip */}
        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.min(hover.x, totalWidth - 320),
              top: hover.y,
              zIndex: 50,
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 11,
              color: "var(--af-text)",
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxWidth: 360,
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
              <span>Active: <strong>{formatDuration(hover.session.activeMs)}</strong></span>
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
  );
}
