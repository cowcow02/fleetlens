"use client";

import { useState, useMemo } from "react";
import type { DailyBucket } from "@claude-sessions/parser";

/**
 * GitHub-style contribution heatmap.
 *
 * Input: array of DailyBucket (pre-sorted ascending by date, with gaps filled).
 * Layout: 7 rows (Sun..Sat) × N week columns.
 */
export function Heatmap({
  buckets,
  valueKey = "sessions",
  cellSize = 13,
  cellGap = 3,
}: {
  buckets: DailyBucket[];
  valueKey?: "sessions" | "toolCalls" | "turns";
  cellSize?: number;
  cellGap?: number;
}) {
  const [hover, setHover] = useState<{ bucket: DailyBucket; x: number; y: number } | null>(null);

  const { weeks, max } = useMemo(() => {
    if (buckets.length === 0) return { weeks: [] as DailyBucket[][], max: 0 };
    const firstBucket = buckets[0]!;
    const firstDate = parseDay(firstBucket.date);
    // Start at the most recent Sunday on or before firstDate.
    const firstSunday = new Date(firstDate);
    firstSunday.setDate(firstSunday.getDate() - firstSunday.getDay());

    // Build an array of DailyBucket (or null for pre-range cells).
    const map = new Map(buckets.map((b) => [b.date, b]));
    const weeks: DailyBucket[][] = [];
    let cur: DailyBucket[] = [];
    const today = new Date();
    const lastBucket = buckets[buckets.length - 1]!;
    const lastDate = parseDay(lastBucket.date);
    const endDate = lastDate > today ? lastDate : today;

    let maxVal = 0;
    for (const d = new Date(firstSunday); d <= endDate; d.setDate(d.getDate() + 1)) {
      const day = formatDay(d);
      const bucket = map.get(day) ?? makeEmpty(day);
      const v = bucket[valueKey];
      if (v > maxVal) maxVal = v;
      cur.push(bucket);
      if (cur.length === 7) {
        weeks.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) {
      while (cur.length < 7) cur.push(makeEmpty(formatDay(new Date())));
      weeks.push(cur);
    }
    return { weeks, max: maxVal };
  }, [buckets, valueKey]);

  if (buckets.length === 0) {
    return (
      <div
        style={{
          padding: "32px 12px",
          color: "var(--af-text-tertiary)",
          fontSize: 12,
          textAlign: "center",
        }}
      >
        No activity yet.
      </div>
    );
  }

  const width = weeks.length * (cellSize + cellGap) + 24;
  const height = 7 * (cellSize + cellGap) + 18;

  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {/* Day labels on the left */}
        <g fontSize={9} fill="var(--af-text-tertiary)">
          {["Mon", "Wed", "Fri"].map((label, i) => (
            <text
              key={label}
              x={0}
              y={18 + (1 + i * 2) * (cellSize + cellGap) + cellSize - 3}
            >
              {label}
            </text>
          ))}
        </g>

        {/* Cells */}
        <g transform="translate(24, 18)">
          {weeks.map((week, wi) =>
            week.map((bucket, di) => {
              const val = bucket[valueKey];
              const fill = colorForValue(val, max);
              return (
                <rect
                  key={`${wi}-${di}`}
                  x={wi * (cellSize + cellGap)}
                  y={di * (cellSize + cellGap)}
                  width={cellSize}
                  height={cellSize}
                  rx={2.5}
                  ry={2.5}
                  stroke={val > 0 ? "rgba(255,255,255,0.04)" : "transparent"}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                    setHover({
                      bucket,
                      x: rect.left + rect.width / 2,
                      y: rect.top - 6,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                  // Use `style.fill` not the `fill` attribute — React does
                  // not expand CSS custom properties (var(--…)) inside the
                  // SVG presentation attribute, but it does resolve them in
                  // inline styles. So all dots render as the placeholder /
                  // first resolved var if we set `fill={...}` directly.
                  style={{ cursor: val > 0 ? "pointer" : "default", fill }}
                />
              );
            }),
          )}
        </g>
      </svg>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 6,
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          justifyContent: "flex-end",
        }}
      >
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((frac, i) => (
          <span
            key={i}
            style={{
              width: 11,
              height: 11,
              borderRadius: 2.5,
              background: colorForValue(Math.max(1, frac * max), max),
              display: "inline-block",
            }}
          />
        ))}
        <span>More</span>
      </div>

      {/* Hover tooltip */}
      {hover && (
        <div
          style={{
            position: "fixed",
            left: hover.x,
            top: hover.y,
            transform: "translate(-50%, -100%)",
            background: "var(--af-surface-elevated)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 11,
            color: "var(--af-text)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 100,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ fontWeight: 600 }}>{hover.bucket.date}</div>
          <div style={{ color: "var(--af-text-secondary)" }}>
            {hover.bucket.sessions} session{hover.bucket.sessions === 1 ? "" : "s"}
            {hover.bucket.toolCalls > 0 && ` · ${hover.bucket.toolCalls} tool calls`}
            {hover.bucket.peakParallelism > 1 && ` · peak ×${hover.bucket.peakParallelism}`}
          </div>
        </div>
      )}
    </div>
  );
}

function colorForValue(val: number, max: number): string {
  if (val <= 0 || max <= 0) return "var(--af-heatmap-0)";
  const frac = Math.min(1, val / max);
  // Clamp to 5 discrete buckets for a GitHub feel
  let bucket = 0;
  if (frac > 0.75) bucket = 4;
  else if (frac > 0.5) bucket = 3;
  else if (frac > 0.25) bucket = 2;
  else if (frac > 0) bucket = 1;
  // CSS vars so the cells adapt to light/dark mode automatically.
  return `var(--af-heatmap-${bucket})`;
}

function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function makeEmpty(date: string): DailyBucket {
  return {
    date,
    sessions: 0,
    toolCalls: 0,
    turns: 0,
    airTimeMs: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    durationMs: 0,
    peakParallelism: 0,
  };
}
