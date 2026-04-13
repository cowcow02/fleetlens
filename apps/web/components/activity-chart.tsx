"use client";

import { useState, useMemo } from "react";
import type { DailyBucket } from "@claude-lens/parser";

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

type Metric =
  | "airTime"
  | "sessions"
  | "toolCalls"
  | "turns"
  | "input"
  | "output"
  | "cacheRead";

const METRIC_CONFIG: Record<
  Metric,
  { label: string; pluck: (b: DailyBucket) => number; color: string; unit?: "ms" }
> = {
  airTime: {
    label: "Agent time",
    pluck: (b) => b.airTimeMs,
    color: "rgba(45, 212, 191, 0.85)",
    unit: "ms",
  },
  sessions: {
    label: "Sessions",
    pluck: (b) => b.sessions,
    color: "rgba(94, 234, 212, 0.85)",
  },
  toolCalls: {
    label: "Tool calls",
    pluck: (b) => b.toolCalls,
    color: "rgba(167, 139, 250, 0.85)",
  },
  turns: {
    label: "Turns",
    pluck: (b) => b.turns,
    color: "rgba(251, 191, 36, 0.85)",
  },
  input: {
    label: "Input tokens",
    pluck: (b) => b.tokens.input,
    color: "rgba(52, 211, 153, 0.85)",
  },
  output: {
    label: "Output tokens",
    pluck: (b) => b.tokens.output,
    color: "rgba(248, 113, 113, 0.85)",
  },
  cacheRead: {
    label: "Cache read",
    pluck: (b) => b.tokens.cacheRead,
    color: "rgba(129, 104, 224, 0.85)",
  },
};

export function ActivityChart({
  buckets,
  defaultMetric = "sessions",
  height = 160,
}: {
  buckets: DailyBucket[];
  defaultMetric?: Metric;
  height?: number;
}) {
  const [metric, setMetric] = useState<Metric>(defaultMetric);
  const [hover, setHover] = useState<{ bucket: DailyBucket; value: number; x: number } | null>(
    null,
  );

  const config = METRIC_CONFIG[metric];

  const { bars, maxVal } = useMemo(() => {
    let max = 0;
    const vals = buckets.map((b) => {
      const v = config.pluck(b);
      if (v > max) max = v;
      return { bucket: b, value: v };
    });
    return { bars: vals, maxVal: max };
  }, [buckets, config]);

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

  // Axis padding
  const padL = 48; // y-axis labels
  const padR = 8;
  const padB = 22; // x-axis labels
  const padT = 10;

  const plotMinWidth = 600;
  const barGap = 2;
  const barWidth = Math.max(
    3,
    Math.floor((plotMinWidth - barGap * bars.length) / Math.max(1, bars.length)),
  );
  const barsTotalWidth = bars.length * (barWidth + barGap);
  const width = padL + Math.max(barsTotalWidth, plotMinWidth) + padR;
  const chartHeight = height - padT - padB;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 4,
          background: "var(--background)",
          borderRadius: 7,
          padding: 3,
          marginBottom: 10,
        }}
      >
        {(Object.keys(METRIC_CONFIG) as Metric[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setMetric(key)}
            style={{
              fontSize: 11,
              padding: "5px 10px",
              border: "none",
              borderRadius: 5,
              background:
                metric === key ? "var(--af-surface-elevated)" : "transparent",
              color: metric === key ? "var(--af-text)" : "var(--af-text-tertiary)",
              fontWeight: 500,
            }}
          >
            {METRIC_CONFIG[key].label}
          </button>
        ))}
      </div>

      <div style={{ position: "relative", overflowX: "auto" }}>
        {hover && (
          <div
            style={{
              position: "absolute",
              left: hover.x,
              top: 0,
              transform: "translateX(-50%)",
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 11,
              color: "var(--af-text-secondary)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 10,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            {hover.bucket.date} ·{" "}
            {config.unit === "ms" ? formatMs(hover.value) : hover.value.toLocaleString()}
          </div>
        )}
        <svg width={width} height={height} style={{ display: "block" }}>
          {/* Y-axis gridlines + labels (0, 25, 50, 75, 100% of maxVal) */}
          <g fontSize={10} fill="var(--af-text-tertiary)">
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const y = padT + (1 - frac) * chartHeight;
              const raw = maxVal * frac;
              const label =
                config.unit === "ms"
                  ? formatMs(raw)
                  : raw >= 1_000_000
                    ? `${(raw / 1_000_000).toFixed(1)}M`
                    : raw >= 1_000
                      ? `${(raw / 1_000).toFixed(1)}k`
                      : Math.round(raw).toString();
              return (
                <g key={frac}>
                  <line
                    x1={padL}
                    x2={width - padR}
                    y1={y}
                    y2={y}
                    stroke="var(--af-border-subtle)"
                    strokeDasharray={frac === 0 ? undefined : "2 3"}
                  />
                  <text x={padL - 6} y={y + 3} textAnchor="end">
                    {label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Bars */}
          {bars.map((bar, i) => {
            const h = maxVal > 0 ? (bar.value / maxVal) * chartHeight : 0;
            const y = padT + chartHeight - h;
            const x = padL + i * (barWidth + barGap);
            const isHovered = hover?.bucket.date === bar.bucket.date;
            return (
              <g key={bar.bucket.date}>
                <rect
                  x={x}
                  y={padT}
                  width={barWidth}
                  height={chartHeight}
                  fill="transparent"
                  onMouseEnter={() =>
                    setHover({ bucket: bar.bucket, value: bar.value, x: x + barWidth / 2 })
                  }
                  onMouseLeave={() => setHover(null)}
                />
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(0.5, h)}
                  fill={isHovered ? "var(--af-accent)" : config.color}
                  rx={barWidth >= 6 ? 1.5 : 0}
                  ry={barWidth >= 6 ? 1.5 : 0}
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}

          {/* X-axis labels — first day, middle day, last day, plus month starts */}
          <g fontSize={10} fill="var(--af-text-tertiary)">
            {bars.map((bar, i) => {
              const d = bar.bucket.date;
              const isFirst = i === 0;
              const isLast = i === bars.length - 1;
              const isMonthStart = d.slice(-2) === "01";
              // Show: first, last, month starts, and (when no month starts and range is short) the middle
              const isMiddle =
                bars.length > 3 &&
                bars.length <= 31 &&
                i === Math.floor(bars.length / 2) &&
                !bars.some((b) => b.bucket.date.slice(-2) === "01");
              if (!isFirst && !isLast && !isMonthStart && !isMiddle) return null;

              const x = padL + i * (barWidth + barGap) + barWidth / 2;
              const label = new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              });
              const anchor = isFirst ? "start" : isLast ? "end" : "middle";
              const xPos = isFirst ? padL : isLast ? width - padR : x;
              return (
                <text key={d} x={xPos} y={height - 6} textAnchor={anchor}>
                  {label}
                </text>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
