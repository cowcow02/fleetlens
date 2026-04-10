"use client";

import { useState, useMemo } from "react";
import type { DailyBucket } from "@claude-sessions/parser";

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
    label: "Active time",
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

  const barGap = 2;
  const barWidth = Math.max(
    3,
    Math.floor((600 - barGap * bars.length) / Math.max(1, bars.length)),
  );
  const width = bars.length * (barWidth + barGap);
  const chartHeight = height - 28;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 4,
            background: "var(--background)",
            borderRadius: 7,
            padding: 3,
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
        {hover && (
          <div
            style={{
              fontSize: 11,
              color: "var(--af-text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {hover.bucket.date} ·{" "}
            {config.unit === "ms" ? formatMs(hover.value) : hover.value.toLocaleString()}
          </div>
        )}
      </div>

      <div style={{ position: "relative", overflowX: "auto" }}>
        <svg width={Math.max(width, 600)} height={height} style={{ display: "block" }}>
          {/* Baseline */}
          <line
            x1={0}
            x2={Math.max(width, 600)}
            y1={chartHeight}
            y2={chartHeight}
            stroke="var(--af-border-subtle)"
            strokeDasharray="2 3"
          />

          {/* Bars */}
          {bars.map((bar, i) => {
            const h = maxVal > 0 ? (bar.value / maxVal) * (chartHeight - 4) : 0;
            const y = chartHeight - h;
            const x = i * (barWidth + barGap);
            const isHovered = hover?.bucket.date === bar.bucket.date;
            return (
              <g key={bar.bucket.date}>
                <rect
                  x={x}
                  y={0}
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

          {/* Month labels every ~4 weeks */}
          <g fontSize={9} fill="var(--af-text-tertiary)">
            {bars.map((bar, i) => {
              const d = bar.bucket.date;
              const day = d.slice(-2);
              if (day !== "01") return null;
              const x = i * (barWidth + barGap) + barWidth / 2;
              const month = new Date(`${d}T00:00:00`).toLocaleString(undefined, { month: "short" });
              return (
                <text key={d} x={x} y={height - 4} textAnchor="middle">
                  {month}
                </text>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
