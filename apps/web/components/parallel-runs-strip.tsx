"use client";

import Link from "next/link";
import type { ParallelRun, SessionMeta } from "@claude-lens/parser";
import { formatDuration, prettyProjectName } from "@/lib/format";

const ROW_H = 16;
const ROW_GAP = 2;
const BAR_INSET = 3; // top/bottom padding within each row

const COLORS = [
  "rgba(45, 212, 191, 0.80)",
  "rgba(167, 139, 250, 0.80)",
  "rgba(248, 113, 113, 0.80)",
  "rgba(52, 211, 153, 0.80)",
  "rgba(251, 191, 36, 0.80)",
  "rgba(236, 72, 153, 0.80)",
  "rgba(34, 211, 238, 0.80)",
  "rgba(168, 85, 247, 0.80)",
];

function pickColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length]!;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

type ResolvedSession = {
  id: string;
  projectName: string;
  segments: { startMs: number; endMs: number }[];
  startMs: number;
  endMs: number;
  preview?: string;
};

function MiniGantt({
  sessions,
  rangeStart,
  rangeEnd,
  width = 280,
}: {
  sessions: ResolvedSession[];
  rangeStart: number;
  rangeEnd: number;
  width?: number;
}) {
  const duration = rangeEnd - rangeStart;
  if (duration <= 0 || sessions.length === 0) return null;

  const svgHeight = sessions.length * (ROW_H + ROW_GAP) - ROW_GAP;

  const msToX = (ms: number) => {
    return ((ms - rangeStart) / duration) * width;
  };

  return (
    <svg width={width} height={svgHeight} style={{ display: "block" }}>
      {sessions.map((s, i) => {
        const y = i * (ROW_H + ROW_GAP);
        const color = pickColor(s.projectName);
        return (
          <g key={s.id}>
            {/* Track background */}
            <rect
              x={0}
              y={y}
              width={width}
              height={ROW_H}
              fill="var(--af-border-subtle)"
              opacity={0.25}
              rx={3}
            />
            {/* Active segments within the run window */}
            {s.segments.map((seg, si) => {
              const x1 = Math.max(0, msToX(seg.startMs));
              const x2 = Math.min(width, msToX(seg.endMs));
              const w = Math.max(x2 - x1, 2);
              return (
                <rect
                  key={si}
                  x={x1}
                  y={y + BAR_INSET}
                  width={w}
                  height={ROW_H - BAR_INSET * 2}
                  fill={color}
                  rx={2}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function ParallelRunsStrip({
  runs,
  sessions,
}: {
  runs: ParallelRun[];
  sessions: SessionMeta[];
}) {
  if (runs.length === 0) {
    return (
      <div className="af-empty" style={{ padding: 24, fontSize: 12 }}>
        No parallel runs detected yet. Try running two sessions at once.
      </div>
    );
  }

  // Build a lookup for session details
  const sessionMap = new Map<string, SessionMeta>();
  for (const s of sessions) {
    sessionMap.set(s.id, s);
  }

  // Show the 10 most recent
  const recent = [...runs].sort((a, b) => b.startMs - a.startMs).slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {recent.map((run, i) => {
        const dur = run.endMs - run.startMs;

        // Resolve session details for the mini Gantt. Use the session's
        // active segments (idle gaps removed) clipped to a window around
        // the run itself so long-idle sessions don't stretch the bars.
        const WINDOW_PAD = 30 * 60 * 1000; // 30-min pad each side
        const winStart = run.startMs - WINDOW_PAD;
        const winEnd = run.endMs + WINDOW_PAD;

        const resolved: ResolvedSession[] = [];
        for (const sid of run.sessions) {
          const meta = sessionMap.get(sid);
          if (!meta) continue;

          // Prefer real active segments; fall back to first/last if missing.
          const rawSegs =
            meta.activeSegments && meta.activeSegments.length > 0
              ? meta.activeSegments
              : meta.firstTimestamp && meta.lastTimestamp
                ? [
                    {
                      startMs: Date.parse(meta.firstTimestamp),
                      endMs: Date.parse(meta.lastTimestamp),
                    },
                  ]
                : [];

          // Clip to window, drop segments that fall outside entirely.
          const clipped = rawSegs
            .map((seg) => ({
              startMs: Math.max(seg.startMs, winStart),
              endMs: Math.min(seg.endMs, winEnd),
            }))
            .filter((seg) => seg.endMs > seg.startMs);

          if (clipped.length === 0) continue;

          resolved.push({
            id: meta.id,
            projectName: meta.projectName,
            segments: clipped,
            startMs: clipped[0]!.startMs,
            endMs: clipped[clipped.length - 1]!.endMs,
            preview: meta.firstUserPreview,
          });
        }
        resolved.sort((a, b) => a.startMs - b.startMs);

        if (resolved.length === 0) return null;

        // Compute range for the mini Gantt from clipped segment bounds.
        let ganttStart = Infinity;
        let ganttEnd = -Infinity;
        for (const s of resolved) {
          for (const seg of s.segments) {
            if (seg.startMs < ganttStart) ganttStart = seg.startMs;
            if (seg.endMs > ganttEnd) ganttEnd = seg.endMs;
          }
        }

        return (
          <div
            key={i}
            style={{
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              background: "var(--af-surface-hover)",
              overflow: "hidden",
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                fontSize: 11,
              }}
            >
              <span style={{ color: "var(--af-text-secondary)" }}>
                {new Date(run.startMs).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span
                className="af-tag af-tag-accent"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
              >
                ×{run.peak} parallel
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                  marginLeft: "auto",
                }}
              >
                {fmtTime(ganttStart)}–{fmtTime(ganttEnd)} · {formatDuration(dur)}
              </span>
            </div>

            {/* Mini Gantt + session labels */}
            <div style={{ padding: "4px 12px 10px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(80px, 140px) 1fr",
                  gap: "0 10px",
                  alignItems: "start",
                }}
              >
                {/* Labels column */}
                <div style={{ display: "flex", flexDirection: "column", gap: ROW_GAP }}>
                  {resolved.map((s) => (
                    <Link
                      key={s.id}
                      href={`/sessions/${s.id}`}
                      style={{
                        height: ROW_H,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 9.5,
                        color: "var(--af-text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textDecoration: "none",
                      }}
                      title={s.preview || prettyProjectName(s.projectName)}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 2,
                          background: pickColor(s.projectName),
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {prettyProjectName(s.projectName)}
                      </span>
                    </Link>
                  ))}
                </div>

                {/* Mini Gantt column */}
                <MiniGantt
                  sessions={resolved}
                  rangeStart={ganttStart}
                  rangeEnd={ganttEnd}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
